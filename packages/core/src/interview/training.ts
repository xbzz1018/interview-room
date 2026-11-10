import { objectArray, record, requiredText, StructuredOutputError } from '../kernel/structured-output.ts'

export type TrainingGap = { point: string; evidence: string; exercise: string }
export type TrainingAttempt = {
  attempt_id: string; question_id: string; question: string; answer: string; original_answer: string
  comparison: string; technical_gaps: TrainingGap[]; expression_gaps: TrainingGap[]; created_at: string
  assisted: true
}

export function trainingComparison(value: unknown, answers: string): Pick<TrainingAttempt, 'comparison' | 'technical_gaps' | 'expression_gaps'> {
  const source = record(value)
  const comparison = requiredText(source.comparison, 'comparison')
  if (comparison.length > 20000) throw new StructuredOutputError('comparison too long', 'comparison')
  const gaps = (key: string): TrainingGap[] => {
    const items = objectArray(source[key], key)
    if (items.length > 6) throw new StructuredOutputError('at most 6 gaps', key)
    return items.map((item, index) => {
      const point = requiredText(item.point, `${key}[${index}].point`)
      const evidence = requiredText(item.evidence, `${key}[${index}].evidence`)
      const exercise = requiredText(item.exercise, `${key}[${index}].exercise`)
      if (!answers.includes(evidence)) throw new StructuredOutputError('evidence must quote the actual answer', `${key}[${index}].evidence`)
      return { point, evidence, exercise }
    })
  }
  return { comparison, technical_gaps: gaps('technical_gaps'), expression_gaps: gaps('expression_gaps') }
}
