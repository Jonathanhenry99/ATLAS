import test from 'node:test';
import assert from 'node:assert/strict';
import { isBoostCampaign, isBoostForAccount, isBoostedPostName } from '../src/config/metaAdsMetrics.js';

// Campaigns Meta creates for the Boost button in the Instagram / Facebook app
// are named after the post, never after the account's Kata Kunci Boost Post.
test('a boosted-post campaign is recognised by the name Meta gives it', () => {
  assert.equal(isBoostedPostName('Instagram post: The Buckle 15 Long Fitted Blazer...'), true);
  assert.equal(isBoostedPostName('Facebook post: Promo akhir bulan'), true);
  assert.equal(isBoostedPostName('Post: "Promo akhir bulan"'), true);
  assert.equal(isBoostedPostName('  instagram post:lowercase'), true);
  assert.equal(isBoostedPostName('NV(Boost Post) | Traffic - Boost IG Post | Jan\'26'), false);
  assert.equal(isBoostedPostName('RM | Sales | Purchase | Instagram post: in the middle'), false);
  assert.equal(isBoostedPostName(null), false);
});

test('the keyword still splits every other campaign', () => {
  assert.equal(isBoostCampaign('NV(Boost Post) | Traffic', 'boost post'), true);
  assert.equal(isBoostCampaign('RM | CV - PUR | Q226', 'boost post'), false);
  assert.equal(isBoostCampaign('Instagram post: As a corporate girlie with...', 'boost post'), true, 'boosted post despite the keyword');
  assert.equal(isBoostCampaign('Instagram post: Inspired by...', 'profile visit'), true);
});

test('a boosted post is Boost in any MAIN account', () => {
  const mixed = { main_kind: 'MIXED', boost_keyword: 'boost post' };
  assert.equal(isBoostForAccount('Instagram post: Introducing a new style...', mixed), true);
  assert.equal(isBoostForAccount('RM | Sales | Purchase', mixed), false);
  assert.equal(isBoostForAccount('Instagram post: x', { main_kind: 'NONBOOST', boost_keyword: null }), true);
  assert.equal(isBoostForAccount('RM | Sales', { main_kind: 'BOOST', boost_keyword: null }), true);
  assert.equal(isBoostForAccount('RM | Sales', { main_kind: 'NONBOOST', boost_keyword: null }), false);
});
