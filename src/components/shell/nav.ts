// Navigation of the shell, shared by the health screens and the
// Administration section. Four sections by what the reader is doing: looking
// at the whole (overview), reading one subject in depth (analysis), building
// their own view of the raw material (data), and following what their own
// devices send (collection). Those four need a subject grant. Administration
// needs the admin flag, and shows instance state only (architecture §1).
import type { Messages } from '@/lib/i18n';
import type { NavSection } from './Sidebar';

export function buildNav(m: Messages, scope: { hasSubject: boolean; isAdmin: boolean }): NavSection[] {
  const sections: NavSection[] = [];
  if (scope.hasSubject) {
    sections.push(
      {
        label: m.nav.overview,
        items: [
          { href: '/', icon: 'monitoring', label: m.nav.dashboard },
          { href: '/week', icon: 'view_week', label: m.nav.week },
          { href: '/calendar', icon: 'calendar_month', label: m.nav.calendar },
        ],
      },
      {
        label: m.nav.analysis,
        items: [
          { href: '/sport', icon: 'exercise', label: m.nav.sport },
          { href: '/sleep', icon: 'bedtime', label: m.nav.sleep },
          { href: '/mood', icon: 'mood', label: m.nav.mood },
          { href: '/markers', icon: 'ecg', label: m.nav.markers },
          { href: '/hrv', icon: 'monitor_heart', label: m.nav.hrv },
          { href: '/ecg', icon: 'cardiology', label: m.nav.ecg },
          { href: '/hearing', icon: 'hearing', label: m.nav.hearing },
          { href: '/records', icon: 'trophy', label: m.nav.records },
        ],
      },
      {
        label: m.nav.data,
        items: [
          { href: '/explore', icon: 'query_stats', label: m.nav.explore },
          { href: '/metrics', icon: 'database', label: m.nav.allData },
        ],
      },
      {
        label: m.nav.collection,
        items: [
          { href: '/sync', icon: 'sync', label: m.nav.sync },
          { href: '/devices', icon: 'devices', label: m.nav.devices },
        ],
      }
    );
  }
  if (scope.isAdmin) {
    sections.push({
      label: m.nav.admin,
      items: [{ href: '/admin', icon: 'group', label: m.nav.members }],
    });
  }
  return sections;
}
