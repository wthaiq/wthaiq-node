import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import type { Account, Balance, Usage } from '../types.js';
import { ApiResource } from './base.js';

/** `GET /`: the account, plan and pricing behind the API key. */
export class AccountResource extends ApiResource {
  async retrieve(options?: RequestOptions): Promise<WthaiqResponse<Account>> {
    return this.requestor.json<Account>('GET', '/', undefined, options);
  }
}

/** `GET /usage`: wallet balance, plan quota, pricing and request counts. */
export class UsageResource extends ApiResource {
  async retrieve(options?: RequestOptions): Promise<WthaiqResponse<Usage>> {
    return this.requestor.json<Usage>('GET', '/usage', undefined, options);
  }
}

/** `GET /balance`: wallet balance and plan quota. */
export class BalanceResource extends ApiResource {
  async retrieve(options?: RequestOptions): Promise<WthaiqResponse<Balance>> {
    return this.requestor.json<Balance>('GET', '/balance', undefined, options);
  }
}
