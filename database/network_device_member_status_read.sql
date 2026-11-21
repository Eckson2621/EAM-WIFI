-- Allow active organization members to inspect their own router's connection status.
DROP POLICY IF EXISTS "members read network devices" ON public.network_devices;
CREATE POLICY "members read network devices" ON public.network_devices
FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));
