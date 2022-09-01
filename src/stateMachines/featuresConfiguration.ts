import { AMT, CIM, Common, IPS } from '@open-amt-cloud-toolkit/wsman-messages'
import { HttpHandler } from '../HttpHandler'
import Logger from '../Logger'
import { assign, createMachine, interpret } from 'xstate'
import { AMTConfiguration, AMTRedirectionServiceEnabledStates, mapAMTUserConsent } from '../models'
import { devices } from '../WebSocketListener'
import { ClientResponseMsg } from '../utils/ClientResponseMsg'
import { RedirectionService } from '@open-amt-cloud-toolkit/wsman-messages/amt/models'
import { IPS_OptInService } from '@open-amt-cloud-toolkit/wsman-messages/models/ips_models'

export interface FeatureContext {
  // 3 requests to the device
  // to get the current configuration
  // get saved here
  clientId: string
  AMT_RedirectionService?: any
  IPS_OptInService?: any
  CIM_KVMRedirectionSAP?: any
  // transient values for computing
  // what configuration changes should be made
  // on the client device
  isRedirectionChanged: boolean
  isOptInServiceChanged: boolean
  errorMessage: string
  amtConfiguration: AMTConfiguration
  httpHandler: HttpHandler
}
interface FeatureEvent {
  type: 'CONFIGURE_FEATURES'
  clientId: string
  data?: any
}
export class FeaturesConfiguration {
  amt: AMT.Messages
  cim: CIM.Messages
  ips: IPS.Messages
  responseMsg: ClientResponseMsg
  logger: Logger

  constructor () {
    this.amt = new AMT.Messages()
    this.cim = new CIM.Messages()
    this.ips = new IPS.Messages()
    this.responseMsg = new ClientResponseMsg()
    this.logger = new Logger('FeaturesConfiguration')
  }

  machine = createMachine<FeatureContext, FeatureEvent>({
    id: 'features-configuration-machine',
    predictableActionArguments: true,
    preserveActionOrder: true,
    context: {
      clientId: '',
      httpHandler: null,
      amtConfiguration: null,
      AMT_RedirectionService: null,
      IPS_OptInService: null,
      CIM_KVMRedirectionSAP: null,
      isRedirectionChanged: false,
      isOptInServiceChanged: false,
      errorMessage: ''
    },
    initial: 'DEFAULT_FEATURES',
    states: {
      DEFAULT_FEATURES: {
        on: {
          CONFIGURE_FEATURES: {
            target: 'GET_AMT_REDIRECTION_SERVICE'
          }
        }
      },
      GET_AMT_REDIRECTION_SERVICE: {
        invoke: {
          id: 'get-amt-redirection-service',
          src: this.getAmtRedirectionService.bind(this),
          onDone: {
            actions: ['cacheAmtRedirectionService'],
            target: 'GET_IPS_OPT_IN_SERVICE'
          },
          onError: {
            actions: ['cacheErrorMessage'],
            target: 'FAILED'
          }
        }
      },
      GET_IPS_OPT_IN_SERVICE: {
        invoke: {
          id: 'get-ips-opt-in-service',
          src: this.getIpsOptInService.bind(this),
          onDone: {
            actions: ['cacheIpsOptInService'],
            target: 'GET_CIM_KVM_REDIRECTION_SAP'
          },
          onError: {
            actions: ['cacheErrorMessage'],
            target: 'FAILED'
          }
        }
      },
      GET_CIM_KVM_REDIRECTION_SAP: {
        invoke: {
          id: 'get-cim-kvm-redirection-sap',
          src: this.getCimKvmRedirectionSAP.bind(this),
          onDone: {
            actions: 'cacheCimKvmRedirectionSAP',
            target: 'COMPUTE_UPDATES'
          },
          onError: {
            actions: ['cacheErrorMessage'],
            target: 'FAILED'
          }
        }
      },

      COMPUTE_UPDATES: {
        id: 'compute-updates',
        entry: ['computeUpdates'],
        always: [
          { target: 'SET_REDIRECTION_SERVICE', cond: (context, _) => context.isRedirectionChanged },
          { target: 'PUT_IPS_OPT_IN_SERVICE', cond: (context, _) => context.isOptInServiceChanged },
          { target: 'SUCCESS' }
        ]
      },
      SET_REDIRECTION_SERVICE: {
        invoke: {
          id: 'set-redirection-service',
          src: this.setRedirectionService.bind(this),
          onDone: 'SET_KVM_REDIRECTION_SAP',
          onError: {
            actions: ['cacheErrorMessage'],
            target: 'FAILED'
          }
        }
      },
      SET_KVM_REDIRECTION_SAP: {
        invoke: {
          id: 'set-kvm-redirection-sap',
          src: this.setKvmRedirectionSap.bind(this),
          onDone: 'PUT_REDIRECTION_SERVICE',
          onError: {
            actions: ['cacheErrorMessage'],
            target: 'FAILED'
          }
        }
      },
      PUT_REDIRECTION_SERVICE: {
        invoke: {
          id: 'put-redirection-service',
          src: this.putRedirectionService.bind(this),
          onDone: [
            { target: 'PUT_IPS_OPT_IN_SERVICE', cond: (context, _) => context.isOptInServiceChanged },
            { target: 'SUCCESS' }
          ],
          onError: {
            actions: ['cacheErrorMessage'],
            target: 'FAILED'
          }
        }
      },
      PUT_IPS_OPT_IN_SERVICE: {
        invoke: {
          id: 'put-ips-opt-in-service',
          src: this.putIpsOptInService.bind(this),
          onDone: 'SUCCESS',
          onError: {
            actions: ['cacheErrorMessage'],
            target: 'FAILED'
          }
        }
      },
      SUCCESS: {
        type: 'final'
      },
      FAILED: {
        entry: (context, _) => this.logger.error(`AMT Features Configuration failed: ${context.errorMessage}`),
        type: 'final'
      }
    }
  },
  {
    actions: {
      cacheAmtRedirectionService: assign({ AMT_RedirectionService: (_, event) => event.data.Envelope.Body.AMT_RedirectionService }),
      cacheIpsOptInService: assign({ IPS_OptInService: (_, event) => event.data.Envelope.Body.IPS_OptInService }),
      cacheCimKvmRedirectionSAP: assign({
        CIM_KVMRedirectionSAP: (_, event) => event.data.Envelope.Body.CIM_KVMRedirectionSAP
      }),
      cacheErrorMessage: assign({ errorMessage: (_, event) => JSON.stringify(event.data) }),
      computeUpdates: assign((context, _) => {
        const amtRedirectionService = context.AMT_RedirectionService
        const cimKVMRedirectionSAP = context.CIM_KVMRedirectionSAP
        const ipsOptInService = context.IPS_OptInService

        let solEnabled = false
        let iderEnabled = false
        let isRedirectionChanged = false

        let enabledState = context.AMT_RedirectionService.EnabledState

        if (enabledState === AMTRedirectionServiceEnabledStates.BOTH_IDER_SOL) {
          solEnabled = true
          iderEnabled = true
        } else if (enabledState === AMTRedirectionServiceEnabledStates.ONLY_IDER) {
          iderEnabled = true
        } else if (enabledState === AMTRedirectionServiceEnabledStates.ONLY_SOL) {
          solEnabled = true
        }
        const kvmEnabled = (
          context.CIM_KVMRedirectionSAP.EnabledState === Common.Models.CIM_KVM_REDIRECTION_SAP_ENABLED_STATE.Enabled ||
          context.CIM_KVMRedirectionSAP.EnabledState === Common.Models.CIM_KVM_REDIRECTION_SAP_ENABLED_STATE.EnabledButOffline
        )

        if (context.amtConfiguration.solEnabled !== solEnabled) {
          solEnabled = context.amtConfiguration.solEnabled
          isRedirectionChanged = true
        }

        if (context.amtConfiguration.iderEnabled !== iderEnabled) {
          iderEnabled = context.amtConfiguration.iderEnabled
          isRedirectionChanged = true
        }

        if ((solEnabled || iderEnabled) && !amtRedirectionService.ListenerEnabled) {
          isRedirectionChanged = true
        }

        if (context.amtConfiguration.kvmEnabled !== kvmEnabled) {
          cimKVMRedirectionSAP.EnabledState = context.amtConfiguration.kvmEnabled
            ? Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Enabled
            : Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Disabled
          isRedirectionChanged = true
        }

        if (isRedirectionChanged) {
          enabledState = AMTRedirectionServiceEnabledStates.DISABLED
          if (iderEnabled && solEnabled) {
            enabledState = AMTRedirectionServiceEnabledStates.BOTH_IDER_SOL
          } else if (iderEnabled) {
            enabledState = AMTRedirectionServiceEnabledStates.ONLY_IDER
          } else if (solEnabled) {
            enabledState = AMTRedirectionServiceEnabledStates.ONLY_SOL
          }
          amtRedirectionService.EnabledState = enabledState
          amtRedirectionService.ListenerEnabled = (solEnabled || iderEnabled || kvmEnabled)
        }

        const cfgOptInValue = mapAMTUserConsent(context.amtConfiguration.userConsent)
        const isOptInServiceChanged = (ipsOptInService.OptInRequired !== cfgOptInValue)
        if (isOptInServiceChanged) {
          ipsOptInService.OptInRequired = cfgOptInValue
        }

        return {
          AMT_RedirectionService: amtRedirectionService,
          IPS_OptInService: ipsOptInService,
          CIM_KVMRedirectionSAP: cimKVMRedirectionSAP,
          isRedirectionChanged: isRedirectionChanged,
          isOptInServiceChanged: isOptInServiceChanged
        }
      })
    }
  })

  service = interpret(this.machine)

  async getAmtRedirectionService (context: FeatureContext): Promise<any> {
    return await this.invokeWsmanCall(context, this.amt.RedirectionService(AMT.Methods.GET))
  }

  async getIpsOptInService (context: FeatureContext): Promise<any> {
    return await this.invokeWsmanCall(context, this.ips.OptInService(IPS.Methods.GET))
  }

  async getCimKvmRedirectionSAP (context: FeatureContext): Promise<any> {
    return await this.invokeWsmanCall(context, this.cim.KVMRedirectionSAP(CIM.Methods.GET))
  }

  async setRedirectionService (context: FeatureContext): Promise<any> {
    return await this.invokeWsmanCall(context, this.amt.RedirectionService(AMT.Methods.REQUEST_STATE_CHANGE, context.AMT_RedirectionService.EnabledState))
  }

  async setKvmRedirectionSap (context: FeatureContext): Promise<any> {
    return await this.invokeWsmanCall(context, this.cim.KVMRedirectionSAP(CIM.Methods.REQUEST_STATE_CHANGE, context.CIM_KVMRedirectionSAP.EnabledState))
  }

  async putRedirectionService (context: FeatureContext): Promise<any> {
    const redirectionService: RedirectionService = context.AMT_RedirectionService
    const redirectionResponse: AMT.Models.RedirectionResponse = {
      AMT_RedirectionService: JSON.parse(JSON.stringify(redirectionService))
    }
    return await this.invokeWsmanCall(context, this.amt.RedirectionService(AMT.Methods.PUT, null, redirectionResponse))
  }

  async putIpsOptInService (context: FeatureContext): Promise<any> {
    const ipsOptInService: IPS_OptInService = context.IPS_OptInService
    const ipsOptInSvcResponse: IPS.Models.OptInServiceResponse = {
      IPS_OptInService: JSON.parse(JSON.stringify(ipsOptInService))
    }
    return await this.invokeWsmanCall(context, this.ips.OptInService(IPS.Methods.PUT, null, ipsOptInSvcResponse))
  }

  async invokeWsmanCall (context: FeatureContext, xmlMessage): Promise<any> {
    const clientObj = devices[context.clientId]
    const message = context.httpHandler.wrapIt(xmlMessage, clientObj.connectionParams)
    const clientMsg = this.responseMsg.get(context.clientId, message, 'wsman', 'ok')
    devices[context.clientId].ClientSocket.send(JSON.stringify(clientMsg))
    clientObj.pendingPromise = new Promise<any>((resolve, reject) => {
      clientObj.resolve = resolve
      clientObj.reject = reject
    })
    return await clientObj.pendingPromise
  }
}