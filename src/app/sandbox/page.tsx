import { notFound } from 'next/navigation';
import SandboxClient from './client';

export default function SandboxPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SandboxClient />;
}
