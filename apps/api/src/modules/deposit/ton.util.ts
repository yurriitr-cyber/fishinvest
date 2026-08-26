/**
 * Minimal TON incoming-tx helpers (TonAPI / toncenter).
 * Amounts in nanotons (1 TON = 1e9).
 */

export type TonIncoming = {
  hash: string;
  valueNano: bigint;
  comment: string;
  utime: number;
};

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

export async function fetchTonIncomings(opts: {
  address: string;
  apiKey?: string;
  limit?: number;
}): Promise<TonIncoming[]> {
  const limit = opts.limit ?? 30;
  // Prefer TonAPI v2
  try {
    const url = `https://tonapi.io/v2/blockchain/accounts/${encodeURIComponent(opts.address)}/transactions?limit=${limit}`;
    const res = await fetch(url, { headers: headers(opts.apiKey) });
    if (res.ok) {
      const data = (await res.json()) as {
        transactions?: Array<{
          hash?: string;
          utime?: number;
          in_msg?: {
            value?: number | string;
            decoded_body?: { text?: string; comment?: string };
            message_content?: { decoded?: { comment?: string } };
            op_code?: number;
          };
        }>;
      };
      const out: TonIncoming[] = [];
      for (const tx of data.transactions || []) {
        const msg = tx.in_msg;
        if (!msg) continue;
        const valueNano = BigInt(msg.value ?? 0);
        if (valueNano <= 0n) continue;
        const comment =
          msg.decoded_body?.text ||
          msg.decoded_body?.comment ||
          msg.message_content?.decoded?.comment ||
          '';
        if (!tx.hash) continue;
        out.push({
          hash: tx.hash,
          valueNano,
          comment: String(comment),
          utime: tx.utime ?? 0,
        });
      }
      return out;
    }
  } catch {
    /* fall through */
  }

  // Fallback: toncenter
  const tc = new URL('https://toncenter.com/api/v2/getTransactions');
  tc.searchParams.set('address', opts.address);
  tc.searchParams.set('limit', String(limit));
  if (opts.apiKey) tc.searchParams.set('api_key', opts.apiKey);
  const res = await fetch(tc);
  if (!res.ok) throw new Error(`toncenter HTTP ${res.status}`);
  const data = (await res.json()) as {
    ok?: boolean;
    result?: Array<{
      transaction_id?: { hash?: string };
      utime?: number;
      in_msg?: { value?: string; message?: string };
    }>;
  };
  if (!data.ok || !data.result) throw new Error('toncenter bad response');

  return data.result
    .map((tx) => {
      const valueNano = BigInt(tx.in_msg?.value ?? '0');
      const comment = tx.in_msg?.message || '';
      return {
        hash: tx.transaction_id?.hash || '',
        valueNano,
        comment,
        utime: tx.utime ?? 0,
      };
    })
    .filter((t) => t.hash && t.valueNano > 0n);
}

export function tonToNano(ton: number): bigint {
  // Avoid float issues: work with 9 decimal places
  const s = ton.toFixed(9);
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt((frac + '000000000').slice(0, 9));
}

export function nanoToTonString(nano: bigint): string {
  const neg = nano < 0n;
  const v = neg ? -nano : nano;
  const whole = v / 1_000_000_000n;
  const frac = (v % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  const body = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${body}` : body;
}

export function buildTonTransferLink(opts: {
  address: string;
  amountNano: bigint;
  comment: string;
}): string {
  const params = new URLSearchParams();
  params.set('amount', opts.amountNano.toString());
  params.set('text', opts.comment);
  return `ton://transfer/${opts.address}?${params.toString()}`;
}

export function memoForDeposit(depositId: string): string {
  return `rf${depositId.replace(/-/g, '').slice(0, 16)}`;
}
