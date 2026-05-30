import {
  buildProfileSearchQuery,
  buildProfileSearchAttempts,
  stripSeniorityPrefix,
} from '../src/jobs/profileFeed';

describe('buildProfileSearchQuery', () => {
  test('returns currentTitle only, not skills', () => {
    const q = buildProfileSearchQuery({
      currentTitle: 'Software Engineer',
      skills: 'React, Node, Python',
    });
    expect(q).toBe('Software Engineer');
  });

  test('returns null when no title', () => {
    expect(buildProfileSearchQuery({ skills: 'React' })).toBeNull();
  });

  test('derives title from experience when currentTitle empty', () => {
    const q = buildProfileSearchQuery({
      experience: [{ title: 'Android Developer', company: 'Acme' }],
    });
    expect(q).toBe('Android Developer');
  });
});

describe('stripSeniorityPrefix', () => {
  test('removes Senior prefix', () => {
    expect(stripSeniorityPrefix('Senior Software Engineer')).toBe('Software Engineer');
  });

  test('leaves title unchanged when no prefix', () => {
    expect(stripSeniorityPrefix('Product Manager')).toBe('Product Manager');
  });
});

describe('buildProfileSearchAttempts', () => {
  test('orders full title, stripped, and last two words when long', () => {
    const attempts = buildProfileSearchAttempts({
      currentTitle: 'Senior Software Engineer Platform',
    });
    expect(attempts[0]).toBe('Senior Software Engineer Platform');
    expect(attempts).toContain('Software Engineer Platform');
    expect(attempts).toContain('Engineer Platform');
  });

  test('dedupes identical attempts', () => {
    const attempts = buildProfileSearchAttempts({ currentTitle: 'Engineer' });
    expect(attempts).toEqual(['Engineer']);
  });
});
