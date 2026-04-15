import { redirect } from 'next/navigation';

// Studio list is now inline in /work — redirect legacy route
export default function WorkStudioPage() {
  redirect('/work?section=studio');
}
