import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { router, publicProcedure, protectedProcedure } from './webdev-adapter.mjs'
import { leaderboard } from './leaderboard.mjs'
import { createLeaderboardRouter } from './leaderboard/router.mjs'
import { FEATHER_ITEMS, PRODUCTS, CURRENCY } from './shop/products.mjs'
import * as store from './shop/store.mjs'
import * as payments from './shop/stripe.mjs'

// Ownership never comes from browser input. Shop purchases belong to the device's guest identity
// (ctx.guest, from the secret restore code header); Manus login (ctx.user) is optional and only
// used for leaderboards and cloud saves.

const TRPC_CODES = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 503: 'INTERNAL_SERVER_ERROR' }
async function guard(fn) {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof store.StoreError) throw new TRPCError({ code: TRPC_CODES[error.status] ?? 'BAD_REQUEST', message: error.code })
    if (error instanceof TRPCError) throw error
    console.error('[game] request failed', error instanceof Error ? error.message : 'unknown')
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'server_error' })
  }
}
/** Requires the X-Guest-Token restore code; exposes it as ctx.player. */
const playerProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.guest) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'guest_required' })
  return next({ ctx: { ...ctx, player: ctx.guest } })
})
const requestHost = ctx => ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host
const productId = z.enum(Object.keys(PRODUCTS))
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)
const boardId = z.enum(['season-v1', 'endless-v1'])

const shop = router({
  /** Public price list for the shop screen. */
  catalog: publicProcedure.query(() => ({
    currency: CURRENCY.toUpperCase(),
    products: Object.entries(PRODUCTS).map(([id, p]) => ({ id, kind: p.kind, name: p.name, description: p.description, amount: p.amount, interval: p.interval ?? null })),
    featherItems: Object.entries(FEATHER_ITEMS).map(([id, i]) => ({ id, cost: i.cost })),
    paymentsEnabled: !!process.env.STRIPE_SECRET_KEY,
  })),
  state: playerProcedure.query(({ ctx }) => guard(() => store.playerState(ctx.player.id))),
  checkout: playerProcedure
    .input(z.object({ product: productId, returnUrl: z.string().max(2048) }).strict())
    .mutation(({ ctx, input }) => guard(() => payments.createCheckout(ctx.player, input.product, input.returnUrl, requestHost(ctx)))),
  orderStatus: playerProcedure
    .input(z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/) }).strict())
    .query(({ ctx, input }) => guard(() => store.orderStatus(ctx.player.id, input.sessionId))),
  orders: playerProcedure.query(({ ctx }) => guard(() => store.listOrders(ctx.player.id))),
  spend: playerProcedure
    .input(z.object({ item: z.enum(Object.keys(FEATHER_ITEMS)), requestId }).strict())
    .mutation(({ ctx, input }) => guard(async () => ({ applied: await store.spendFeathers(ctx.player.id, input.item, input.requestId), state: await store.playerState(ctx.player.id) }))),
  useBonusEgg: playerProcedure
    .input(z.object({ requestId }).strict())
    .mutation(({ ctx, input }) => guard(async () => ({ applied: await store.useBonusEgg(ctx.player.id, input.requestId) }))),
  claimRunFeathers: playerProcedure
    .input(z.object({ runId: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) => guard(() => store.claimRunFeathers(ctx.user?.id ?? null, ctx.player.id, input.runId))),
  cancelMembership: playerProcedure.mutation(({ ctx }) => guard(async () => {
    await payments.setMembershipCancel(ctx.player.id, true)
    return store.playerState(ctx.player.id)
  })),
  resumeMembership: playerProcedure.mutation(({ ctx }) => guard(async () => {
    await payments.setMembershipCancel(ctx.player.id, false)
    return store.playerState(ctx.player.id)
  })),
  billingPortal: playerProcedure
    .input(z.object({ returnUrl: z.string().max(2048) }).strict())
    .mutation(({ ctx, input }) => guard(() => payments.billingPortal(ctx.player.id, input.returnUrl, requestHost(ctx)))),
})

const save = router({
  get: protectedProcedure.query(({ ctx }) => guard(() => store.loadSave(ctx.user.id))),
  put: protectedProcedure
    .input(z.object({ data: z.record(z.string(), z.unknown()) }).strict())
    .mutation(({ ctx, input }) => guard(() => store.storeSave(ctx.user.id, input.data))),
})

const boards = router({
  /** Public all-time or this-week ranking, with Swoop Club badges; `me` marks the caller's row. */
  get: publicProcedure
    .input(z.object({ boardId, period: z.enum(['all', 'week']) }).strict())
    .query(({ ctx, input }) => guard(() => store.board(input.boardId, input.period, ctx.user?.id ?? null))),
})

export const gameRouter = router({
  leaderboard: createLeaderboardRouter({ router, publicProcedure, protectedProcedure }, leaderboard),
  player: protectedProcedure.query(({ ctx }) => ({ id: ctx.user.id, name: ctx.user.name })),
  shop,
  save,
  boards,
})
