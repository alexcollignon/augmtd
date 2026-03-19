import { Suspense } from 'react';
import CaptureClient from './capture-client';

export default function CaptureMeetingPage() {
  return (
    <Suspense>
      <CaptureClient />
    </Suspense>
  );
}
