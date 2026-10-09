import { supabase } from '../../services/supabaseClient';

export type DispatchTab = 'dine_in' | 'delivery' | 'pickup';
export type ReadyOrder = {
  id: string; orderNumber: string; customerName: string; address: string; total: number;
  readyAt: string; pickupMethod: 'customer' | 'third_party_courier' | null;
  orderType: 'delivery' | 'pickup' | 'dine_in'; riderId: string | null;
};
export type Rider = {
  id: string; name: string; mobileNumber: string; status: 'available' | 'busy';
  activeDeliveries: number; deliveredToday: number;
};
export type RiderDeliveryStatus = 'assigned' | 'delivering';
export type RiderDelivery = {
  id: string; orderNumber: string; customerName: string; address: string; total: number;
  status: RiderDeliveryStatus;
};
export type RiderHistoryItem = {
  id: string; orderNumber: string; customerName: string; total: number; createdAt: string;
  status: 'delivered' | 'failed'; failureReason: string | null;
};
type OrderRow = {
  id:string; order_number:string; customer_name:string; delivery_address:string|null;
  delivery_barangay:string|null; total:number|string; created_at:string;
  pickup_method:'customer'|'third_party_courier'|null; order_type:'delivery'|'pickup'|'dine_in'; rider_id:string|null;
};
type RiderRow = { id:string; name:string; mobile_number:string };
type AssignmentRow = { rider_id:string; status:'assigned'|'delivering'|'delivered'|'cancelled'; assigned_at:string; delivered_at:string|null };

function formatReadyTime(value:string) {
  return new Intl.DateTimeFormat('en-PH',{hour:'numeric',minute:'2-digit'}).format(new Date(value));
}
function todayStartIso(){ const now=new Date(); return new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString(); }

export async function getDispatchData(restaurantId:string):Promise<{orders:ReadyOrder[]; riders:Rider[]}> {
  if(!supabase) throw new Error('Supabase is not configured.');
  const [orderResult,riderResult,activeOrderResult,assignmentResult]=await Promise.all([
    supabase.from('orders').select('id,order_number,customer_name,delivery_address,delivery_barangay,total,created_at,pickup_method,order_type,rider_id').eq('restaurant_id',restaurantId).in('order_type',['delivery','pickup','dine_in']).eq('status','ready').order('created_at',{ascending:true}),
    supabase.from('restaurant_staff').select('id,name,mobile_number').eq('restaurant_id',restaurantId).eq('role','rider').eq('is_active',true).order('name',{ascending:true}),
    supabase.from('orders').select('rider_id,delivery_status').eq('restaurant_id',restaurantId).not('rider_id','is',null).in('delivery_status',['assigned','delivering']),
    supabase.from('delivery_assignments').select('rider_id,status,delivered_at').eq('restaurant_id',restaurantId),
  ]);
  if(orderResult.error) throw orderResult.error;
  if(riderResult.error) throw riderResult.error;
  if(activeOrderResult.error) throw activeOrderResult.error;
  if(assignmentResult.error) throw assignmentResult.error;
  const activeOrders=(activeOrderResult.data??[]) as Array<{rider_id:string;delivery_status:'assigned'|'delivering'}>;
  const assignments=(assignmentResult.data??[]) as Array<Pick<AssignmentRow,'rider_id'|'status'|'delivered_at'>>;
  const activeByRider=new Map<string,number>(), deliveredTodayByRider=new Map<string,number>();
  const start=todayStartIso();
  for(const order of activeOrders){
    activeByRider.set(order.rider_id,(activeByRider.get(order.rider_id)??0)+1);
  }
  for(const a of assignments){
    if(a.status==='delivered'&&a.delivered_at&&a.delivered_at>=start) deliveredTodayByRider.set(a.rider_id,(deliveredTodayByRider.get(a.rider_id)??0)+1);
  }
  const orders=((orderResult.data??[]) as OrderRow[]).map(o=>({
    id:o.id,orderNumber:o.order_number,customerName:o.customer_name,address:o.delivery_address??o.delivery_barangay??'Pickup at restaurant',
    total:Number(o.total),readyAt:formatReadyTime(o.created_at),pickupMethod:o.pickup_method,orderType:o.order_type,riderId:o.rider_id
  }));
  const riders=((riderResult.data??[]) as RiderRow[]).map(r=>({
    id:r.id,name:r.name,mobileNumber:r.mobile_number,
    status:((activeByRider.get(r.id)??0)>0?'busy':'available') as Rider['status'],
    activeDeliveries:activeByRider.get(r.id)??0,deliveredToday:deliveredTodayByRider.get(r.id)??0
  }));
  return {orders,riders};
}

export async function getRiderDashboardData(userId:string):Promise<{riderName:string;deliveries:RiderDelivery[];history:RiderHistoryItem[]}> {
  if(!supabase) throw new Error('Supabase is not configured.');
  const {data:rider,error:riderError}=await supabase.from('restaurant_staff').select('id,name').eq('role','rider').eq('is_active',true).eq('auth_user_id',userId).maybeSingle();
  if(riderError) throw riderError;
  if(!rider) throw new Error('Your account is not linked to a rider profile. Please contact the restaurant.');

  const [activeResult,historyResult]=await Promise.all([
    supabase.from('orders').select('id,order_number,customer_name,delivery_address,delivery_barangay,total,delivery_status').eq('rider_id',rider.id).eq('order_type','delivery').in('delivery_status',['assigned','delivering']).order('created_at',{ascending:true}),
    supabase.from('orders').select('id,order_number,customer_name,total,created_at,delivery_status,delivery_failure_reason').eq('rider_id',rider.id).eq('order_type','delivery').in('delivery_status',['delivered','failed']).order('created_at',{ascending:false}),
  ]);
  if(activeResult.error) throw activeResult.error;
  if(historyResult.error) throw historyResult.error;
  const activeRows=(activeResult.data??[]) as Array<{id:string;order_number:string;customer_name:string;delivery_address:string|null;delivery_barangay:string|null;total:number|string;delivery_status:RiderDeliveryStatus}>;
  const historyRows=(historyResult.data??[]) as Array<{id:string;order_number:string;customer_name:string;total:number|string;created_at:string;delivery_status:'delivered'|'failed';delivery_failure_reason:string|null}>;
  return {
    riderName:rider.name||'Rider',
    deliveries:activeRows.map(order=>({id:order.id,orderNumber:order.order_number,customerName:order.customer_name,address:order.delivery_address??order.delivery_barangay??'Delivery address not provided',total:Number(order.total),status:order.delivery_status})),
    history:historyRows.map(order=>({id:order.id,orderNumber:order.order_number,customerName:order.customer_name,total:Number(order.total),createdAt:order.created_at,status:order.delivery_status,failureReason:order.delivery_failure_reason??null}))
  };
}

export async function assignDelivery(restaurantId:string,orderId:string,riderId:string){
  if(!supabase) throw new Error('Supabase is not configured.');
  const {error:assignmentError}=await supabase.from('delivery_assignments').insert({order_id:orderId,rider_id:riderId,restaurant_id:restaurantId,status:'assigned'});
  if(assignmentError) throw assignmentError;
  const {data,error:orderError}=await supabase.from('orders').update({rider_id:riderId,delivery_status:'assigned',rider_assigned_at:new Date().toISOString()}).eq('id',orderId).eq('restaurant_id',restaurantId).or('delivery_status.eq.unassigned,delivery_status.is.null').select('id').maybeSingle();
  if(orderError||!data){
    await supabase.from('delivery_assignments').delete().eq('order_id',orderId).eq('rider_id',riderId).eq('status','assigned');
    throw orderError??new Error('The order could not be updated for rider assignment. Please refresh and try again.');
  }
}

export async function completeDispatchHandoff(restaurantId:string,orderId:string,orderType:'pickup'|'dine_in'){
  if(!supabase) throw new Error('Supabase is not configured.');
  const {data,error}=await supabase.from('orders').update({status:'completed'}).eq('id',orderId).eq('restaurant_id',restaurantId).eq('order_type',orderType).eq('status','ready').select('id').maybeSingle();
  if(error) throw error;
  if(!data) throw new Error('This order is no longer ready for handoff. Please refresh the Dispatch page.');
}

export function subscribeToDispatchChanges(
  restaurantId: string,
  onChange: () => void,
  onStatusChange: (status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') => void,
): (() => void) | null {
  if (!supabase) return null;

  const channel = supabase
    .channel(`delivery-dispatch:${restaurantId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_staff', filter: `restaurant_id=eq.${restaurantId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments', filter: `restaurant_id=eq.${restaurantId}` }, onChange)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onStatusChange(status);
      }
    });

  return () => {
    void supabase?.removeChannel(channel);
  };
}
