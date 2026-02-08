import { redirect } from 'next/navigation';

export default function HomePage() {
  // Redirect to login
  // Middleware will redirect authenticated users to /inbox
  redirect('/login');
}
