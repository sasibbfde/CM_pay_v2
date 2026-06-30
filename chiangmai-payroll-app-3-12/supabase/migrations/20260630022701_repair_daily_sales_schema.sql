alter table public.daily_sales
  add column if not exists gross_sales numeric default 0,
  add column if not exists net_sales numeric default 0;

update public.daily_sales
set gross_sales = coalesce(nullif(gross_sales, 0), sales_amount, 0),
    net_sales = coalesce(nullif(net_sales, 0), sales_amount, 0)
where coalesce(gross_sales, 0) = 0 or coalesce(net_sales, 0) = 0;

alter table public.daily_sales enable row level security;
