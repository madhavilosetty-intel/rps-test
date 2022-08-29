import { interpret } from 'xstate'
import { Error } from './error'
import { v4 as uuid } from 'uuid'
import { devices } from '../WebSocketListener'
const clientId = uuid()
const unauthorizedResponse = {
  statusCode: 401,
  headers: [
    { name: 'X-Frame-Options', value: 'DENY' },
    {
      name: 'Content-Type',
      value: 'application/soap+xml; charset=UTF-8'
    },
    { name: 'Transfer-Encoding', value: 'chunked' },
    {
      name: 'Www-Authenticate',
      value: 'Digest realm="Digest:34BF4B5A0561F95248F58509A406E046", nonce="bQali2IAAAAAAAAAn0xaWCOcxNsRcEHX",stale="false",qop="auth"'
    }
  ],
  body: {
  }
}

describe('Error State Machine', () => {
  let config
  let currentStateIndex
  let error: Error
  beforeEach(() => {
    error = new Error()
    currentStateIndex = 0
    config = {
      services: {
      },
      actions: {
        parseError: () => {},
        respondUnknown: () => {},
        respondBadRequest: () => {}
      },
      guards: {
        isBadRequest: () => false,
        isUnauthorized: () => false
      }
    }
    devices[clientId] = {
      unauthCount: null,
      ClientId: clientId,
      ClientSocket: { send: jest.fn() } as any,
      ClientData: '',
      ciraconfig: {},
      network: {},
      status: {},
      activationStatus: {},
      connectionParams: {
        guid: '4c4c4544-004b-4210-8033-b6c04f504633',
        port: 16992,
        digestChallenge: null,
        username: 'admin',
        password: 'P@ssw0rd'
      },
      uuid: '4c4c4544-004b-4210-8033-b6c04f504633',
      messageId: 1
    }
  })

  it('should eventually reach "UNKNOWN"', (done) => {
    const mockerrorMachine = error.machine.withConfig(config)
    const flowStates = ['ERRORED', 'UNKNOWN']
    const errorService = interpret(mockerrorMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('UNKNOWN') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    errorService.start()
    errorService.send({ type: 'PARSE', clientId: clientId })
  })

  it('should eventually reach "BADREQUEST"', (done) => {
    config.guards = {
      isBadRequest: () => true
    }
    const mockerrorMachine = error.machine.withConfig(config)
    const flowStates = ['ERRORED', 'BADREQUEST']
    const errorService = interpret(mockerrorMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('BADREQUEST') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    errorService.start()
    errorService.send({ type: 'PARSE', clientId: clientId })
  })

  it('should add authorization header', () => {
    const context = {
      message: unauthorizedResponse,
      clientId: clientId
    }
    expect(devices[clientId].connectionParams.digestChallenge).toBeNull()
    error.addAuthorizationHeader(context)
    expect(devices[clientId].connectionParams.digestChallenge).not.toBeNull()
  })

  // it('should respond for bad request', () => {
  //   const respondSpy = jest.spyOn(error.machine, 'respond').mockImplementation().mockReturnValue()
  //   const context = {
  //     message: '',
  //     parsedMessage: '',
  //     clientId: clientId
  //   }
  //   error.addAuthorizationHeader(context)
  // })
})