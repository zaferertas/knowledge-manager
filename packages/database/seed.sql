INSERT INTO users (id, email, password_hash)
VALUES ('73e6abb5-4821-47b1-bde5-cd439eabba20', 'field-notes@example.test', 'disabled-fixture')
ON CONFLICT (id) DO NOTHING;

INSERT INTO notes (id, user_id, title, body)
VALUES (
  '6eaf3256-f770-4ee6-9a46-7743ee927cd8',
  '73e6abb5-4821-47b1-bde5-cd439eabba20',
  'Plan a community garden',
  'Measure the raised beds and label the seedlings before the weekend.'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tags (id, user_id, name, normalized_name)
VALUES (
  'aea946c4-6bec-44f5-8fc4-1a7f2beda34b',
  '73e6abb5-4821-47b1-bde5-cd439eabba20',
  'Gardening',
  'gardening'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO note_tags (user_id, note_id, tag_id)
VALUES (
  '73e6abb5-4821-47b1-bde5-cd439eabba20',
  '6eaf3256-f770-4ee6-9a46-7743ee927cd8',
  'aea946c4-6bec-44f5-8fc4-1a7f2beda34b'
)
ON CONFLICT (user_id, note_id, tag_id) DO NOTHING;
