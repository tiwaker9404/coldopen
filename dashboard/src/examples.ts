import type { ProfileData } from './api.ts'

export const BLANK: ProfileData = {
  preset: 'candidate',
  sender: { name: '', company: '', role: '' },
  offer: '',
  points: ['', '', ''],
  proof: [
    { value: '', label: '', where: '' },
    { value: '', label: '', where: '' },
    { value: '', label: '', where: '' },
  ],
  cta: { line: 'Worth a 15-minute call?', contact: '' },
}

/** Starter profiles for different roles, bundled from profiles/ at build time. */
export const EXAMPLES = Object.entries(
  import.meta.glob<{ default: ProfileData }>(
    ['../../profiles/examples/*.json', '../../profiles/*.example.json'],
    { eager: true },
  ),
)
  .map(([path, mod]) => ({
    id: path
      .split('/')
      .pop()!
      .replace(/(\.example)?\.json$/, ''),
    data: mod.default,
  }))
  .map((e) => ({
    ...e,
    label:
      e.id === 'sales'
        ? 'Selling a product'
        : e.id === 'candidate'
          ? 'Software engineer'
          : (e.data.sender.role ?? e.id),
  }))
  .sort((a, b) => (a.id === 'sales' ? 1 : b.id === 'sales' ? -1 : a.label.localeCompare(b.label)))
