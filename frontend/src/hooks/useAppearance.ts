import { useSyncExternalStore } from 'react';
import { getAppearanceState, subscribeAppearance } from '../lib/appearance';

export default function useAppearance() {
  return useSyncExternalStore(subscribeAppearance, getAppearanceState, getAppearanceState);
}
