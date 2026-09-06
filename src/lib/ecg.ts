// ECG display rules shared by the list and the detail. The badge tone
// encodes what Apple's classification means for the reader: a sinus rhythm
// reads calm, atrial fibrillation reads alarming, an inconclusive reading is
// a caution, anything else is neutral.
import type { BadgeTone } from '@/components/ui/Badge';

export function classificationTone(classification: string): BadgeTone {
  if (classification === 'sinus_rhythm') return 'ok';
  if (classification === 'atrial_fibrillation') return 'danger';
  if (classification.startsWith('inconclusive')) return 'warn';
  return 'neutral';
}
