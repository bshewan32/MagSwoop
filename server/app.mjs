import express from 'express'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { registerOAuthRoutes, createContext, webdevRouter, router, publicPlatformConfig } from './webdev-adapter.mjs'
import { webhook as stripeWebhook } from './shop/stripe.mjs'

export function createGameApp(gameRouter, { leaderboard } = {}) {
  const app = express()
  app.disable('x-powered-by')
  // Stripe signs the exact bytes: raw body, no JSON parser, no session/Origin checks.
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    stripeWebhook(req, res).catch(() => {
      if (!res.headersSent) res.status(500).json({ error: 'processing_failed' })
    })
  })
  if (leaderboard) app.use(leaderboard.middleware)
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  app.get('/api/auth/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(publicPlatformConfig())
  })
  registerOAuthRoutes(app)
  // Browser mutations use Webdev's JSON tRPC transport. Do not enable CORS or
  // accept form/text bodies: cross-origin forms must not create a Checkout or
  // mutate a player's save using the SameSite=None session cookie.
  app.use('/api/trpc', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'POST' && !req.is('application/json')) {
      res.status(415).json({ error: 'json_required' })
      return
    }
    next()
  }, createExpressMiddleware({
    router: router({ webdev: webdevRouter, game: gameRouter }),
    createContext,
  }))
  // Stripe webhooks belong outside /api/trpc. Register the application's
  // signature-verified raw-body handler before any JSON body parser.
  return app
}
