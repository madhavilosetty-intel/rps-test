/*********************************************************************
* Copyright (c) Intel Corporation 2021
* SPDX-License-Identifier: Apache-2.0
**********************************************************************/
import Logger from '../../../Logger'
import { WirelessConfig } from '../../../RCS.Config'
import { IWirelessProfilesDb } from '../../../repositories/interfaces/IWirelessProfilesDB'
import { WirelessConfigDbFactory } from '../../../repositories/factories/WirelessConfigDbFactory'
import { API_RESPONSE, API_UNEXPECTED_EXCEPTION } from '../../../utils/constants'
import { DataWithCount } from '../../../models/Rcs'
import { validationResult } from 'express-validator'
import { MqttProvider } from '../../../utils/MqttProvider'

export async function allProfiles (req, res): Promise<void> {
  const log = new Logger('allProfiles')
  let profilesDb: IWirelessProfilesDb = null
  const top = req.query.$top
  const skip = req.query.$skip
  const count = req.query.$count
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      MqttProvider.publishEvent('fail', ['allWirelessProfiles'], 'Failed to get all wireless profiles')
      res.status(400).json({ errors: errors.array() })
      return
    }
    profilesDb = WirelessConfigDbFactory.getConfigDb()
    let wirelessConfigs: WirelessConfig[] = await profilesDb.get(top, skip)
    if (wirelessConfigs.length >= 0) {
      wirelessConfigs = wirelessConfigs.map((result: WirelessConfig) => {
        delete result.pskPassphrase
        return result
      })
    }
    if (count == null || count === 'false' || count === '0') {
      MqttProvider.publishEvent('success', ['allWirelessProfiles'], 'No wireless profiles to get')
      res.status(200).json(API_RESPONSE(wirelessConfigs)).end()
    } else {
      const count: number = await profilesDb.getCount()
      const dataWithCount: DataWithCount = {
        data: wirelessConfigs,
        totalCount: count
      }
      MqttProvider.publishEvent('success', ['allWirelessProfiles'], 'Sent all wireless profiles')
      res.status(200).json(API_RESPONSE(dataWithCount)).end()
    }
  } catch (error) {
    MqttProvider.publishEvent('fail', ['allWirelessProfiles'], 'Failed to get all wireless profiles')
    log.error('Failed to get all network profiles :', error)
    res.status(500).json(API_RESPONSE(null, null, API_UNEXPECTED_EXCEPTION('GET all Network Configs'))).end()
  }
}