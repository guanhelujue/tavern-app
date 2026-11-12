import { describe, expect, it, vi } from 'vitest';
import { applyCreationPlanningFields, validateCreationFields } from './creation-target';
import { createEmptyCreationSession } from '../novel-creation/domain';
vi.mock('../novel-creation/draft-repository', () => ({ asyncStorageCreationDrafts: {} }));

const fields = { title: '宗门', premise: '', identity: '', desire: '', obstacle: '', setting: '三个宗门；修炼消耗寿命', stakes: '', opening: '', direction: '', tone: '', constraints: '不使用系统', engine: '', arcs: '发现代价\n尝试改变规则', openThreads: '' };
describe('planning blueprint conversion', () => {
  it('maps exact fields while retaining undecided blanks for editing', () => {
    const source = createEmptyCreationSession();
    const next = applyCreationPlanningFields(source, fields);
    expect(next.id).toBe(source.id);
    expect(next.step).toBe('blueprint');
    expect(next.blueprint?.setting).toBe(fields.setting);
    expect(next.blueprint?.protagonist.desire).toBe('');
    expect(next.blueprint?.longForm.arcs).toEqual(['发现代价', '尝试改变规则']);
    expect(source.blueprint).toBeUndefined();
  });
  it('rejects unknown fields and malformed field values before writing', () => {
    expect(() => validateCreationFields({ ...fields, novelId: 'other' })).toThrow('未知字段');
    expect(() => validateCreationFields({ ...fields, setting: [] })).toThrow('不完整');
  });
});
