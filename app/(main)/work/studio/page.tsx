import { redirect } from 'next/navigation';

// Studio has moved to /studio — redirect legacy route
export default function WorkStudioPage() {
  redirect('/studio');
}
