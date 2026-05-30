'use client';

import { withShaderJourney } from '@/components/withShaderJourney';
import { signalBloomFrag } from './shader';

export default withShaderJourney(signalBloomFrag, { accent: '#ff3da6' });