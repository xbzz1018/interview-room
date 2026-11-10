import type { InterviewQuestion, InterviewSession } from './model.ts'

/** Transcript positions keep historical sessions addressable without rewriting them. */
export function resumeQuestions(session: InterviewSession): InterviewQuestion[] {
  return session.transcript.flatMap((message, index) => {
    if (message.role !== 'assistant' || !message.content.trim()) return []
    if (session.transcript[index + 1]?.role !== 'user') return []
    return [{ id: `resume-turn-${index + 1}`, question: message.content }]
  })
}
