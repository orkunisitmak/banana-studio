// A small, explicit workspace protocol. It is used by the loopback client and
// server; it does not accept SQL, arbitrary table names or executable filters.
export class WorkspaceQuery {
  constructor(send, table, rpc, args) {
    this.send = send;
    this.plan = rpc ? { rpc, args } : { table, operation: 'select', filters: [], order: [] };
  }
  select(columns = '*', options = {}) { this.plan.columns = columns; this.plan.count = options.count; this.plan.head = !!options.head; this.plan.returning = true; return this; }
  insert(value) { this.plan.operation = 'insert'; this.plan.value = value; return this; }
  upsert(value, options = {}) { this.plan.operation = 'upsert'; this.plan.value = value; this.plan.onConflict = options.onConflict; if (options.ignoreDuplicates) this.plan.ignoreDuplicates = true; return this; }
  update(value) { this.plan.operation = 'update'; this.plan.value = value; return this; }
  delete() { this.plan.operation = 'delete'; return this; }
  filter(column, operator, value) { this.plan.filters.push({ column, operator, value }); return this; }
  eq(c,v) { return this.filter(c,'eq',v); } neq(c,v) { return this.filter(c,'neq',v); }
  gt(c,v) { return this.filter(c,'gt',v); } gte(c,v) { return this.filter(c,'gte',v); }
  lt(c,v) { return this.filter(c,'lt',v); } lte(c,v) { return this.filter(c,'lte',v); }
  in(c,v) { return this.filter(c,'in',v); } is(c,v) { return this.filter(c,'is',v); }
  ilike(c,v) { return this.filter(c,'ilike',v); } like(c,v) { return this.filter(c,'like',v); }
  contains(c,v) { return this.filter(c,'contains',v); }
  or(value) { this.plan.or = value; return this; }
  not(c,op,v) { return this.filter(c,'not.'+op,v); }
  order(column, options = {}) { this.plan.order.push({ column, ascending: options.ascending !== false }); return this; }
  range(from,to) { this.plan.range = [from,to]; return this; }
  limit(value) { this.plan.limit = value; return this; }
  single() { this.plan.single = true; return this; }
  maybeSingle() { this.plan.single = 'maybe'; return this; }
  abortSignal(signal) { this.signal = signal; return this; }
  then(resolve,reject) { return this.send(this.plan,this.signal).then(resolve,reject); }
}
