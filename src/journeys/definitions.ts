// Every journey's definition, by slug — for whatever runs journeys outside a
// page (the bare harness, the tools). Pages import their own.

import type { JourneyDefinition } from '@wjh/journey/definition'
import foundry from './foundry/journey'
import hollowOrchard from './hollow-orchard/journey'
import natatorium from './natatorium/journey'
import scenicRoute from './scenic-route/journey'
import skybridges from './skybridges/journey'
import switchback from './switchback/journey'
import loopLine from './loop-line/journey'
import stairwell from './stairwell/journey'
import liminal from './liminal/journey'


export const JOURNEY_DEFINITIONS: Record<string, JourneyDefinition> = {
  'foundry':        foundry,
  'hollow-orchard': hollowOrchard,
  'natatorium':     natatorium,
  'scenic-route':   scenicRoute,
  'skybridges':     skybridges,
  'switchback':     switchback,
  'loop-line':      loopLine,
  'stairwell':      stairwell,
  'liminal':        liminal,
}
