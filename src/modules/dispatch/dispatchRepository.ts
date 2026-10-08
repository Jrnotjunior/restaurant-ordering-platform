import { supabase } from '../../services/supabaseClient';

export type DispatchTab = 'dine_in' | 'delivery' | 'pickup';
export type ReadyOrder = {
  id: string; orderNumber: string; customerName: string; address: string; total: number;
  readyAt: string; pickupMethod: 'customer' | 'third_party_courier' | null;
  orderType: 'delivery' | 'pickup' | 'dine_in'; riderId: string | null;
};
export type Rider = {
  id: string; name: string; mobileNumber: string; status: 'available' | 'delivering';
  activeDeliveries: number; deliveredToday: number;
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
  const [orderResult,riderResult,assignmentResult]=await Promise.all([
    supabase.from('orders').select('id,order_number,customer_name,delivery_address,delivery_barangay,total,created_at,pickup_method,order_type,rider_id').eq('restaurant_id',restaurantId).in('order_type',['delivery','pickup','dine_in']).eq('status','ready').order('created_at',{ascending:true}),
    supabase.from('restaurant_staff').select('id,name,mobile_number').eq('restaurant_id',restaurantId).eq('role','rider').eq('is_active',true).order('name',{ascending:true}),
    supabase.from('delivery_assignments').select('rider_id,status,assigned_at,delivered_at').eq('restaurant_id',restaurantId),
  ]);
  if(orderResult.error) throw orderResult.error;
  if(riderResult.error) throw riderResult.error;
  if(assignmentResult.error) throw assignmentResult.error;
  const assignments=(assignmentResult.data??[]) as AssignmentRow[];
  const activeByRider=new Map<string,number>(), deliveringByRider=new Map<string,number>(), deliveredTodayByRider=new Map<string,number>();
  const start=todayStartIso();
  for(const a of assignments){
    if(a.status==='assigned'||a.status==='delivering') activeByRider.set(a.rider_id,(activeByRider.get(a.rider_id)??0)+1);
    if(a.status==='delivering') deliveringByRider.set(a.rider_id,(deliveringByRider.get(a.rider_id)??0)+1);
    if(a.status==='delivered'&&a.delivered_at&&a.delivered_at>=start) deliveredTodayByRider.set(a.rider_id,(deliveredTodayByRider.get(a.rider_id)??0)+1);
  }
  const orders=((orderResult.data??[]) as OrderRow[]).map(o=>({
    id:o.id,orderNumber:o.order_number,customerName:o.customer_name,address:o.delivery_address??o.delivery_barangay??'Pickup at restaurant',
    total:Number(o.total),readyAt:formatReadyTime(o.created_at),pickupMethod:o.pickup_method,orderType:o.order_type,riderId:o.rider_id
  }));
  const riders=((riderResult.data??[]) as RiderRow[]).map(r=>({
    id:r.id,name:r.name,mobileNumber:r.mobile_number,
    status:((deliveringByRider.get(r.id)??0)>0?'delivering':'available') as Rider['status'],
    activeDeliveries:activeByRider.get(r.id)??0,deliveredToday:deliveredTodayByRider.get(r.id)??0
  }));
  return {orders,riders};
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
  const {error}=await supabase.from('orders').update({status:'completed'}).eq('id',orderId).eq('restaurant_id',restaurantId).in('order_type',['pickup','dine_in']).eq('status','ready');
  if(error) throw error;
}
