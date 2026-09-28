'use server';
// Administration actions. Each one re-derives the instance context: a server
// action is a public endpoint, the layout that rendered the button proves
// nothing.
import { revalidatePath } from 'next/cache';
import { getInstanceContext, revokeMemberDevice } from '@/lib/queries/instance';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function revokeMemberDeviceAction(formData: FormData): Promise<void> {
  const ictx = await getInstanceContext();
  if (!ictx) return;
  const subjectId = String(formData.get('subjectId') ?? '');
  const deviceId = String(formData.get('deviceId') ?? '');
  if (!UUID.test(subjectId) || !UUID.test(deviceId)) return;
  await revokeMemberDevice(ictx, subjectId, deviceId);
  revalidatePath('/admin');
  revalidatePath(`/admin/members/${subjectId}`);
}
