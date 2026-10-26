import { OrderSummary } from '@/components/OrderSummary';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderSummary orderId={id} />;
}
