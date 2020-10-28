import { Injector } from 'reduct'
import { Server } from 'http'
import * as Koa from 'koa'
import * as cors from '@koa/cors'
import * as Router from 'koa-router'
import * as Long from 'long'
import * as raw from 'raw-body'
import { Redis } from './Redis'
import { Config } from './Config'
import { decodeReceipt, Receipt, ReceiptWithHMAC, verifyReceipt as verifyReceiptBytes } from 'ilp-protocol-stream'
import { generateReceiptSecret, hmac } from '../util/crypto'

export const RECEIPT_LENGTH_BASE64 = 80

const verifyReceipt = (receiptSeed: Buffer, redis: Redis) => async (ctx: Koa.Context, next: Koa.Next) => {
  const body = await raw(ctx.req, {
    limit: RECEIPT_LENGTH_BASE64
  })

  let receipt: Receipt
  try {
    const receiptBytes = Buffer.from(body.toString(), 'base64')
    ctx.state.receipt = verifyReceiptBytes(receiptBytes, (decoded: ReceiptWithHMAC) => {
      return generateReceiptSecret(receiptSeed, decoded.nonce)
    })
  } catch (error) {
    ctx.throw(400, error.message)
  }

  try {
    ctx.state.receiptValue = await redis.getReceiptValue(ctx.state.receipt)
  } catch (error) {
    ctx.throw(409, error.message)
  }

  if (ctx.state.receiptValue.isZero()) {
    // too old or value is less than previously submitted receipt
    ctx.throw(400, 'expired receipt')
  }
  await next()
}

export class Receipts {
  private config: Config
  private redis: Redis
  private server: Server

  constructor (deps: Injector) {
    this.config = deps(Config)
    this.redis = deps(Redis)
  }

  start (): void {
    const koa = new Koa()
    const router = new Router()

    router.post('/receipts', verifyReceipt(this.config.receiptSeed, this.redis), async (ctx: Koa.Context) => {
      const spspEndpoint = await this.redis.getReceiptSPSPEndpoint(ctx.state.receipt.nonce.toString('base64'))
      ctx.response.body = JSON.stringify({
        amount: ctx.state.receiptValue.toString(),
        spspEndpoint
      })
      return ctx.status = 200
    })

    koa.use(cors())
    koa.use(router.routes())
    koa.use(router.allowedMethods())
    this.server = koa.listen(this.config.port, () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log('Receipts API listening on port: ' + this.config.port)
      }
    })
  }

  stop (): void {
    this.server.close()
  }
}