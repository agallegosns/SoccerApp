import { afterEach, describe, expect, it } from 'vitest';

import { clearPublished, resetPublishedForTests, togglePublished } from './published.ts';
import {
  clearScheduled,
  defaultSchedule,
  formatScheduled,
  getScheduled,
  localDateTimeToMs,
  msToLocalDateTime,
  publishState,
  resetScheduledForTests,
  setScheduled,
} from './scheduled.ts';

afterEach(() => {
  resetScheduledForTests();
  resetPublishedForTests();
});

describe('programado', () => {
  it('convierte hora local ⇄ milisegundos sin perder nada', () => {
    const ms = localDateTimeToMs('2026-10-21T19:15');
    expect(msToLocalDateTime(ms)).toBe('2026-10-21T19:15');
    expect(Number.isNaN(localDateTimeToMs('mañana'))).toBe(true);
  });

  it('guarda y quita la hora; ignora formatos raros', () => {
    setScheduled('a', '2026-10-21T19:00');
    setScheduled('b', 'no es una fecha');
    expect(getScheduled()).toEqual({ a: '2026-10-21T19:00' });
    clearScheduled('a');
    expect(getScheduled()).toEqual({});
  });

  it('estado: programado → pendiente de confirmar al llegar la hora → publicado', () => {
    const at = localDateTimeToMs('2026-10-21T19:00');
    const sched = { a: '2026-10-21T19:00' };
    expect(publishState('a', {}, sched, at - 1)).toBe('scheduled');
    expect(publishState('a', {}, sched, at)).toBe('due');
    expect(publishState('a', { a: '2026-10-21' }, sched, at + 1)).toBe('published');
    expect(publishState('a', new Set(['a']), sched, at + 1)).toBe('published');
    expect(publishState('z', {}, sched, at)).toBe('none');
  });

  it('marcar como publicado quita la programación', () => {
    setScheduled('a', '2026-10-21T19:00');
    togglePublished('a', '2026-10-21');
    expect(getScheduled()).toEqual({});
    clearPublished('a');
  });

  it('propone 1 h 30 antes del partido si queda tiempo, y si no, dentro de 15 min redondeados', () => {
    const now = localDateTimeToMs('2026-10-21T12:00');
    expect(defaultSchedule({ date: '2026-10-21', time: '21:00' }, now)).toBe('2026-10-21T19:30');
    expect(defaultSchedule({ date: '2026-10-21', time: '12:30' }, now)).toBe('2026-10-21T12:15');
    expect(defaultSchedule({ date: '2026-10-21', time: null }, now)).toBe('2026-10-21T12:15');
  });

  it('formatea fecha corta y hora', () => {
    expect(formatScheduled('2026-10-21T19:00')).toMatch(/21.*19:00/);
    expect(formatScheduled('raro')).toBe('raro');
  });
});
