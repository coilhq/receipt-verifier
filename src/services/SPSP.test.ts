import reduct from 'reduct'
import fetch from 'node-fetch'
import { createServer, Server } from 'http'
import { SPSP } from './SPSP'
import { Config } from './Config'

describe('SPSP', () => {
  let spsp: SPSP
  let config: Config
  let targetServer: Server
  const targetResp = 'Hello SPSP!'

  beforeAll(async () => {
    targetServer = createServer(function (req, res) {
      res.write(targetResp)
      res.end()
    })
    targetServer.listen()
    const address = targetServer.address()
    if (address && typeof address === 'object') {
      process.env.SPSP_ENDPOINT = `http://localhost:${address.port}`
    }
    const deps = reduct()
    spsp = deps(SPSP)
    config = deps(Config)
    spsp.start()
  })

  afterAll(() => {
    targetServer.close()
    spsp.stop()
  })

  describe('GET /.well-known/pay', () => {
    it('requires spsp4 header', async () => {
      const resp = await fetch(`http://localhost:${config.spspProxyPort}/.well-known/pay`, {
        headers: {
          Accept: 'application/json'
        }
      })
      expect(resp.ok).toBeFalsy()
      expect(resp.status).toBe(404)
    })

    it('proxies request to specified SPSP endpoint', async () => {
      const resp = await fetch(`http://localhost:${config.spspProxyPort}/.well-known/pay`, {
        headers: {
          Accept: 'application/spsp4+json'
        }
      })
      expect(resp.status).toBe(200)
      const body = await resp.text()
      expect(body).toBe(targetResp)
    })
  })
})
