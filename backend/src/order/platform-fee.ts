export const PLATFORM_FEE_RATE = 0.1;

export function computePlatformFee(amount: number): number {
  return Math.floor(amount * PLATFORM_FEE_RATE);
}
