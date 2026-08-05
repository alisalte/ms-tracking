/**
 * Money value object — amount + ISO 4217 currency. Matches the API money shape
 * (API_Design.md §2.1: `{ "amount": "12.50", "currency": "USD" }` string amount).
 * Amount is a string to avoid IEEE-754 floating point loss for currency.
 */
import { ValueObject } from '../domain/ValueObject.js';

const CURRENCY_RE = /^[A-Z]{3}$/;

export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

export class Money extends ValueObject<MoneyProps> {
  protected constructor(props: MoneyProps) {
    super(props);
  }

  /** Construct a validated Money. Throws on malformed input. */
  public static of(amount: string, currency: string): Money {
    if (!CURRENCY_RE.test(currency)) {
      throw new Error(`Invalid ISO 4217 currency code: ${currency}`);
    }
    if (!/^-?\d+(\.\d+)?$/.test(amount)) {
      throw new Error(`Invalid monetary amount: ${amount}`);
    }
    return new Money({ amount, currency });
  }

  public get amount(): string {
    return this.props.amount;
  }

  public get currency(): string {
    return this.props.currency;
  }
}
