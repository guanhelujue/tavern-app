import type { PlanningSession } from './domain';

/** Persist the reply before updating memory, so a failed update never repeats a successful reply. */
export async function completePlanningTurn(
  initial: PlanningSession,
  ports: {
    reply(session: PlanningSession, prompt: string): Promise<string>;
    remember(session: PlanningSession, prompt: string, reply: string, turnId: string): Promise<PlanningSession>;
    save(session: PlanningSession): Promise<void>;
  },
): Promise<PlanningSession> {
  if (!initial.pending) return initial;
  let state = initial;
  if (state.pending!.reply === undefined) {
    const pending = state.pending!;
    const reply = await ports.reply(state, pending.prompt);
    state = {
      ...state, pending: { ...pending, reply },
      messages: [...state.messages, { id: `${pending.id}-assistant`, role: 'assistant', content: reply }],
    };
    await ports.save(state);
  }
  const pending = state.pending!;
  const updated = await ports.remember(state, pending.prompt, pending.reply!, pending.id);
  const next = { ...updated, pending: undefined };
  await ports.save(next);
  return next;
}
