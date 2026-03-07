'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getFollowedTeams } from '@/lib/user-prefs';

/**
 * Smart hero CTA that adapts based on whether the user already has teams saved.
 * New visitors see "Get Started"; returning users go straight to their schedule.
 */
export function HeroCTA() {
  const [hasTeams, setHasTeams] = useState(false);

  useEffect(() => {
    setHasTeams(getFollowedTeams().length > 0);
  }, []);

  if (hasTeams) {
    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link href="/schedule">
          <Button size="lg" className="gap-2 w-full sm:w-auto">
            <Calendar className="h-4 w-4" />
            Go to My Schedule
          </Button>
        </Link>
        <Link href="/onboarding">
          <Button size="lg" variant="outline" className="w-full sm:w-auto">
            Change My Teams
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
      <Link href="/onboarding">
        <Button size="lg" className="gap-2 w-full sm:w-auto">
          Choose Your Teams
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
      <Link href="/schedule">
        <Button size="lg" variant="outline" className="w-full sm:w-auto">
          See a Demo
        </Button>
      </Link>
    </div>
  );
}
