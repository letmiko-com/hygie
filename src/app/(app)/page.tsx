// Temporary home: the dashboard lands here in the next increment; until
// then the sync screen is the only visible surface.
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/sync');
}
