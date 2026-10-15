-- Seeds ONLY the global checklists (from the finalized Cartesian sheets).
-- No installations or assets are seeded — the system starts empty.
-- Idempotent via ON CONFLICT DO NOTHING.

insert into checklists (asset_type, label, default_sop_url) values
  ('bot',   'LIFT BOT',                   'https://drive.google.com/drive/u/5/search?q=Preventative%20maintenance'),
  ('lift',  'XYZ LIFT',                   'https://docs.google.com/document/d/1VYR-57G8CNd_v1sIOz5SMP-1oA2_MfxUKasdgfMoZBs/edit?tab=t.0'),
  ('other', 'Layout & other equipments',  'https://drive.google.com/drive/u/5/search?q=Preventative%20maintenance')
on conflict (asset_type) do nothing;

insert into pm_definitions
  (asset_type, pm_key, name, category, frequency_unit, frequency_every, photo_required, sop_url, sort_order)
values
  -- LIFT BOT
  ('bot','clean-dust','Equipment is clean and free from dust','Visual','month',1,true,null,1),
  ('bot','calibration','Bot calibrations','Visual/Functional','month',1,true,null,2),
  ('bot','abnormal-noise','Any abnormal noise in equipment','Functional','month',1,false,null,3),
  ('bot','wheel-damage','Wheel damage','Visual/Functional','month',1,true,null,4),
  ('bot','torque-lm','Torque check on the fasteners: LM block screws','Visual/Functional','month',1,true,null,5),
  ('bot','torque-jam','Torque check on scissor frame jam nut','Visual/Functional','month',1,true,null,6),
  ('bot','lubricate','Lubricate: zipchain, LM rails, telescopic rails, belt & pulleys','Functional','month',1,false,null,7),
  ('bot','hardware-damage','Any hardware damage on equipment','Visual','month',1,true,null,8),
  -- XYZ LIFT
  ('lift','clean-dust','Equipment is clean and free from dust','Visual','month',1,true,null,1),
  ('lift','rack-pinion','Rack and pinion engagement','Visual','month',1,true,null,2),
  ('lift','abnormal-noise','Any abnormal noise in equipment','Functional','month',1,false,null,3),
  ('lift','torque-power-lock','Torque check on the fasteners: Power lock','Functional','month',1,false,null,4),
  ('lift','guide-sheet-wheel','Check for guide sheet and wheel conditions','Visual/Functional','month',1,true,null,5),
  ('lift','lube-rack-pinion','Lubricate: Rack & Pinion','Functional','month',1,false,null,6),
  ('lift','limit-switches','Check of all limit switches and sensors','Functional','month',1,false,null,7),
  -- Layout & other equipments
  ('other','staubli-charging','Staubli connector engagement — charging module','Visual/Functional','month',1,true,'https://docs.google.com/document/d/1S41SpBsmFMla0ToqZzYornaXTnjrEmn7ZPZIqmRSpeY/edit?tab=t.0',1),
  ('other','botpath-guides','Guide sheets deformation / wear of botpaths','Visual/Functional','month',1,true,null,2),
  ('other','emergency-buttons','Working of emergency push buttons','Visual/Functional','month',1,true,null,3),
  ('other','bin-presence','Function of the bin presence sensors — pickwall module','Visual/Functional','month',1,true,null,4),
  ('other','solenoid-stoppers','Engagement of solenoid stoppers (botpaths, lift indexer, parking & charging)','Visual/Functional','month',1,true,null,5)
on conflict (asset_type, pm_key) do nothing;
