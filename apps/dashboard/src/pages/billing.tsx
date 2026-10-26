import { ErrorNote, Loading, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtNum } from '@/lib/format';
import { loadScript } from '@/lib/scripts';
import type { Plan } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon } from 'lucide-react';
import { toast } from 'sonner';

interface Sub {
  subscription: { status: string; currentPeriodEnd: string | null; plan: Plan } | null;
  razorpayKeyId: string | null;
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

export function BillingPage() {
  const { user, reload } = useAuth();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/billing/plans') });
  const sub = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get<Sub>('/billing/subscription'),
  });

  const subscribe = useMutation({
    mutationFn: (planCode: string) =>
      api.post<{ subscriptionId: string; keyId: string; shortUrl: string }>('/billing/subscribe', {
        planCode,
      }),
    onSuccess: async (r) => {
      await loadScript('https://checkout.razorpay.com/v1/checkout.js');
      if (!window.Razorpay) return void (window.location.href = r.shortUrl);
      new window.Razorpay({
        key: r.keyId,
        subscription_id: r.subscriptionId,
        name: 'PingX',
        prefill: { email: user?.email },
        handler: () => {
          toast.success('Payment received. Your plan updates in a few seconds.');
          setTimeout(() => {
            void reload();
            qc.invalidateQueries({ queryKey: ['subscription'] });
          }, 4000);
        },
      }).open();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post('/billing/cancel'),
    onSuccess: () => {
      toast.success('Subscription will end at the close of the current period');
      qc.invalidateQueries({ queryKey: ['subscription'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (plans.isLoading) return <Loading />;
  if (plans.error) return <ErrorNote error={plans.error} />;
  const s = sub.data?.subscription;

  return (
    <>
      <PageHeader
        title="Billing"
        description="Plans are billed monthly in INR via Razorpay. Limits apply per account across all projects."
      />
      {s && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <div>
              <p className="font-medium">
                {s.plan.name} subscription{' '}
                <Badge variant="outline" className="ml-1 capitalize">
                  {s.status}
                </Badge>
              </p>
              <p className="text-muted-foreground">
                Current period ends {fmtDate(s.currentPeriodEnd)}
              </p>
            </div>
            {['active', 'pending'].includes(s.status) && (
              <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancel subscription
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.data?.map((p) => {
          const current = user?.plan.code === p.code;
          return (
            <Card key={p.id} className={current ? 'ring-2 ring-primary' : ''}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {p.name}
                  {current && <Badge>Current</Badge>}
                </CardTitle>
                <CardDescription>
                  <span className="text-2xl font-semibold text-foreground">₹{p.priceInr}</span> /
                  month
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {[
                  `${fmtNum(p.dailyLimit)} emails / day`,
                  `${fmtNum(p.monthlyLimit)} emails / month`,
                  `${p.burstPerSecond} sends / second`,
                  `${p.aiDailyLimit} AI drafts / day`,
                  'Unlimited providers & projects',
                  'Automatic provider fallback',
                ].map((f) => (
                  <p key={f} className="flex items-center gap-2">
                    <CheckIcon className="size-4 text-emerald-600" />
                    {f}
                  </p>
                ))}
              </CardContent>
              <CardFooter>
                {current ? (
                  <Button className="w-full" variant="outline" disabled>
                    Your plan
                  </Button>
                ) : p.priceInr === 0 ? null : (
                  <Button
                    className="w-full"
                    disabled={!p.razorpayPlanId || subscribe.isPending}
                    onClick={() => subscribe.mutate(p.code)}
                  >
                    {p.razorpayPlanId ? `Upgrade to ${p.name}` : 'Coming soon'}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </>
  );
}
