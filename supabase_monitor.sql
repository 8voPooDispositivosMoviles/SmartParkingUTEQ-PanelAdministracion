-- Permisos mínimos para el monitor de ingresos.
-- Ejecutar después de supabase_parqueadero_uteq.sql en el SQL Editor de Supabase.

grant select (
  id,
  codigo,
  columna,
  numero,
  estado,
  distancia_cm,
  ultima_actualizacion
) on public.puestos to anon, authenticated;

drop policy if exists "Lectura publica de puestos para monitor" on public.puestos;

create policy "Lectura publica de puestos para monitor"
on public.puestos
for select
to anon, authenticated
using (true);

-- Habilita eventos UPDATE/INSERT/DELETE para la suscripción del frontend.
alter publication supabase_realtime add table public.puestos;
