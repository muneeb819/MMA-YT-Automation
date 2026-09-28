import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { MOCK_MODE } from '@/lib/config';
import { ToastProvider } from '@/components/providers';
import { AppShell } from '@/components/app-shell';
import { getDb } from '@/db';
import { eq } from 'drizzle-orm';
import { userSettings } from '@/db/schema';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Load defaults so the shell can show real credit balance.
  let brandName: string | null = null;
  try {
    const db = await getDb();
    const [settings] = await db
      .select({ brandName: userSettings.brandName })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    brandName = settings?.brandName ?? null;
  } catch {
    // The shell must render even if settings are unavailable.
  }

  return (
    <ToastProvider>
      <AppShell
        credits={user.credits}
        demoMode={MOCK_MODE}
        userName={brandName || user.name}
        isAdmin={user.role === 'ADMIN'}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
