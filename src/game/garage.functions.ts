import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { DEFAULT_GARAGE, type GarageState } from './player-cars';

// Guest capability: possession of this unguessable token authorizes only this garage.
// Only its SHA-256 hash is stored. No anonymous auth accounts or public table access.
export const garageAction = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['read', 'claim', 'select']), car: z.enum(['revuelto', 'chiron']).optional(), confirmed: z.boolean().optional() }))
  .handler(async ({ data }): Promise<GarageState> => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.token));
    const token_hash = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    if (data.action === 'claim') {
      if (data.confirmed !== true) throw new Error('Confirme o resgate primeiro.');
      const { error } = await supabaseAdmin.from('guest_garages').upsert({ token_hash, chiron_owned: true, selected_car: 'chiron', updated_at: new Date().toISOString() });
      if (error) throw new Error('Não foi possível salvar o resgate. Tente novamente.');
    }
    const { data: row, error } = await supabaseAdmin.from('guest_garages').select('chiron_owned,selected_car').eq('token_hash', token_hash).maybeSingle();
    if (error) throw new Error('Não foi possível carregar sua garagem.');
    if (data.action === 'select') {
      const car = data.car ?? 'revuelto';
      if (car === 'chiron' && !row?.chiron_owned) throw new Error('Resgate a Chiron primeiro.');
      if (row) {
        const { error: saveError } = await supabaseAdmin.from('guest_garages').update({ selected_car: car, updated_at: new Date().toISOString() }).eq('token_hash', token_hash);
        if (saveError) throw new Error('Não foi possível salvar sua escolha.');
      }
      return { chironOwned: row?.chiron_owned ?? false, selectedCar: car };
    }
    return row ? { chironOwned: row.chiron_owned, selectedCar: row.selected_car === 'chiron' ? 'chiron' : 'revuelto' } : DEFAULT_GARAGE;
  });