(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CustomerDisplayState=api;})(globalThis,function(){
 const shared={DISCONNECTED:'offline',ORDER_CANCELLED:'welcome',PAYMENT_STARTED:'payment',PAYMENT_SUCCESS:'success',ORDER_COMPLETED:'success',PAYMENT_FAILED:'shopping',ORDER_STARTED:'shopping',DISCOUNT_APPLIED:'discount',RESET:'welcome'};
 const transitions={idle:{...shared,CONNECTED:'welcome'},welcome:{...shared},shopping:{...shared},discount:{...shared,REWARD_FINISHED:'shopping'},payment:{...shared},success:{...shared},offline:{...shared,CONNECTED:'welcome'}};
 function initial(){return {mode:'idle',order:null,event:'INIT',sequence:0,epoch:'',online:false,notice:null};}
 function reduce(previous,event){
  if(!event||!event.type)return previous;
  const next={...previous,event:event.type};if(event.state)next.order=event.state;
  if(event.sequence!=null)next.sequence=event.sequence;if(event.epoch)next.epoch=event.epoch;
  next.mode=transitions[previous.mode]?.[event.type]||previous.mode;
  if(['SNAPSHOT','CONNECTED'].includes(event.type)){
    if(event.online===false)next.mode='offline';else if(event.state?.phase==='success')next.mode='success';else if(event.state?.phase==='payment')next.mode='payment';else next.mode=event.state?.items?.length?'shopping':'welcome';
  }
  if(['ITEM_ADDED','ITEM_REMOVED','ITEM_UPDATED','QUANTITY_CHANGED','TOTAL_UPDATED','CUSTOMER_IDENTIFIED','LOYALTY_UPDATED'].includes(event.type)&&!['payment','discount'].includes(previous.mode))next.mode=next.order?.items?.length?'shopping':'welcome';
  if(event.type==='DISCONNECTED')next.online=false;else if(!['RESET','REWARD_FINISHED'].includes(event.type))next.online=true;
  if(event.type==='PAYMENT_FAILED')next.notice='failed';else if(event.type==='ORDER_CANCELLED')next.notice='cancelled';else if(event.type!=='REWARD_FINISHED')next.notice=null;
  if(next.mode==='discount'&&next.order?.discount<=0)next.mode='shopping';
  if(event.type==='RESET')next.order=null;return next;
 }
 return {initial,reduce,transitions};
});
