import { Field, PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

export function SettingsPage() {
  const { user, reload } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const saveName = useMutation({
    mutationFn: () => api.patch('/auth/me', { name }),
    onSuccess: () => { void reload(); toast.success('Saved'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/auth/change-password', pw),
    onSuccess: () => { setPw({ currentPassword: '', newPassword: '' }); toast.success('Password updated'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-2xl gap-6">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle><CardDescription>{user.email}{user.emailVerified ? ' · verified' : ' · not verified'}</CardDescription></CardHeader>
          <CardContent>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); saveName.mutate(); }}>
              <Field label="Name" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Button type="submit" variant="outline" disabled={saveName.isPending}>Save</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{user.hasPassword ? 'Change password' : 'Set a password'}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}>
              {user.hasPassword && <Field label="Current password"><Input type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>}
              <Field label="New password" hint="At least 8 characters"><Input type="password" minLength={8} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
              <Button type="submit" className="justify-self-start" disabled={changePw.isPending}>Update password</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
