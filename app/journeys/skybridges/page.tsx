'use client';

import { withShaderJourney } from '@/components/withShaderJourney';
import { skybridgesFrag } from './shader';

export default withShaderJourney(skybridgesFrag, { accent: '#9fd8ff' });