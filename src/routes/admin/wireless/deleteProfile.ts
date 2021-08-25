/*********************************************************************
 * Copyright (c) Intel Corporation 2021
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/
import Logger from '../../../Logger'
import { IWirelessProfilesDb } from '../../../repositories/interfaces/IWirelessProfilesDB'
import { WirelessConfigDbFactory } from '../../../repositories/factories/WirelessConfigDbFactory'
import { API_RESPONSE, API_UNEXPECTED_EXCEPTION, NETWORK_CONFIG_NOT_FOUND } from '../../../utils/constants'
import { RPSError } from '../../../utils/RPSError'
import { EnvReader } from '../../../utils/EnvReader'
import { MqttProvider } from '../../../utils/MqttProvider'

export async function deleteWirelessProfile (req, res): Promise<void> {
  const log = new Logger('deleteWirelessProfile')
  let wirelessDb: IWirelessProfilesDb = null
  const { profileName } = req.params
  wirelessDb = WirelessConfigDbFactory.getConfigDb()
  try {
    const results: boolean = await wirelessDb.delete(profileName)
    if (results) {
      if (req.secretsManager) {
        await req.secretsManager.deleteSecretWithPath(`${EnvReader.GlobalEnvConfig.VaultConfig.SecretsPath}Wireless/${profileName}`)
      }
      MqttProvider.publishEvent('success', ['deleteWirelessProfiles'], `Deleted wireless profile : ${profileName}`)
      log.verbose(`Deleted wireless profile : ${profileName}`)
      res.status(204).end()
    } else {
      MqttProvider.publishEvent('fail', ['deleteWirelessProfiles'], `Wireless Profile Not Found : ${profileName}`)
      res.status(404).json(API_RESPONSE(null, 'Not Found', NETWORK_CONFIG_NOT_FOUND('Wireless', profileName))).end()
    }
  } catch (error) {
    MqttProvider.publishEvent('fail', ['deleteWirelessProfiles'], `Failed to delete wireless profile : ${profileName}`)
    log.error(`Failed to delete wireless profile : ${profileName}`, error)
    if (error instanceof RPSError) {
      res.status(400).json(API_RESPONSE(null, error.message)).end()
    } else {
      res.status(500).json(API_RESPONSE(null, null, API_UNEXPECTED_EXCEPTION(`Delete wireless profile ${profileName}`))).end()
    }
  }
}