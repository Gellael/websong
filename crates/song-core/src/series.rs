use crate::{Card, Suit};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameError {
    GameOver,
    WrongPhase,
    NotYourTurn,
    NotAlive,
    AlreadyOpened,
    BadSize,
    CardsNotInHand,
    DuplicateCard,
    BadPosition,
    NotContiguous,
    SuitMismatch,
    NeedNatural,
    NoSuchSeries,
    CannotAttach,
    BadSet,
    NoSuchSet,
    SetAlreadyRevived,
    RankLocked, // rank ini sudah dimatikan: isi ke set mati, bukan ke seri
}

/// Kartu beserta posisinya di dalam seri (1..=14, A bisa 1 atau 14).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Placed {
    pub card: Card,
    pub pos: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Series {
    pub owner: usize,
    pub suit: Suit,
    pub cards: Vec<Placed>, // terurut naik berdasarkan pos, selalu berurutan
}

impl Series {
    pub fn lo(&self) -> u8 {
        self.cards.first().unwrap().pos
    }
    pub fn hi(&self) -> u8 {
        self.cards.last().unwrap().pos
    }
}

fn check_placed(p: &Placed) -> Result<(), GameError> {
    if p.pos < 1 || p.pos > 14 {
        return Err(GameError::BadPosition);
    }
    if !p.card.is_joker() {
        let ok = p.pos == p.card.rank || (p.card.rank == 1 && p.pos == 14);
        if !ok {
            return Err(GameError::BadPosition);
        }
    }
    Ok(())
}

/// Jenis dari kartu asli (non-joker). Err kalau ada lebih dari satu jenis.
fn natural_suit(cards: &[Placed]) -> Result<Option<Suit>, GameError> {
    let mut suit = None;
    for p in cards.iter().filter(|p| !p.card.is_joker()) {
        match suit {
            None => suit = Some(p.card.suit),
            Some(s) if s != p.card.suit => return Err(GameError::SuitMismatch),
            _ => {}
        }
    }
    Ok(suit)
}

/// Pastikan semua kartu ada di tangan dan tidak ada yang dipakai dua kali.
pub fn check_in_hand(hand: &[Card], cards: &[Placed]) -> Result<(), GameError> {
    let mut seen = HashSet::new();
    for p in cards {
        if !seen.insert(p.card.id) {
            return Err(GameError::DuplicateCard);
        }
        if !hand.contains(&p.card) {
            return Err(GameError::CardsNotInHand);
        }
    }
    Ok(())
}

/// Validasi dan bentuk seri baru (3..=5 kartu).
pub fn build_series(owner: usize, cards: Vec<Placed>) -> Result<Series, GameError> {
    if !(3..=5).contains(&cards.len()) {
        return Err(GameError::BadSize);
    }
    for p in &cards {
        check_placed(p)?;
    }
    let suit = natural_suit(&cards)?.ok_or(GameError::NeedNatural)?;
    let mut cards = cards;
    cards.sort_by_key(|p| p.pos);
    if cards.windows(2).any(|w| w[1].pos != w[0].pos + 1) {
        return Err(GameError::NotContiguous);
    }
    Ok(Series { owner, suit, cards })
}

/// Sambung seri yang sudah ada dengan 1 atau 2 kartu di ujung bawah/atas.
/// Seri hanya diubah kalau semuanya valid.
pub fn extend_series(series: &mut Series, cards: Vec<Placed>) -> Result<(), GameError> {
    if !(1..=2).contains(&cards.len()) {
        return Err(GameError::BadSize);
    }
    for p in &cards {
        check_placed(p)?;
    }
    if let Some(s) = natural_suit(&cards)? {
        if s != series.suit {
            return Err(GameError::SuitMismatch);
        }
    }

    let mut remaining = cards;
    let mut added = Vec::new();
    let (mut lo, mut hi) = (series.lo(), series.hi());
    loop {
        if lo > 1 {
            if let Some(i) = remaining.iter().position(|p| p.pos == lo - 1) {
                added.push(remaining.remove(i));
                lo -= 1;
                continue;
            }
        }
        if hi < 14 {
            if let Some(i) = remaining.iter().position(|p| p.pos == hi + 1) {
                added.push(remaining.remove(i));
                hi += 1;
                continue;
            }
        }
        break;
    }
    if !remaining.is_empty() {
        return Err(GameError::CannotAttach);
    }

    series.cards.extend(added);
    series.cards.sort_by_key(|p| p.pos);
    Ok(())
}

fn natural_at(hand: &[Card], suit: Suit, pos: u8) -> bool {
    let rank = if pos == 14 { 1 } else { pos };
    hand.iter()
        .any(|c| !c.is_joker() && c.suit == suit && c.rank == rank)
}

/// Apakah tangan ini bisa membentuk minimal satu seri baru (3 kartu)?
pub fn can_open(hand: &[Card]) -> bool {
    let jokers = hand.iter().filter(|c| c.is_joker()).count();
    for suit in [Suit::Diamonds, Suit::Clubs, Suit::Hearts, Suit::Spades] {
        for start in 1..=12u8 {
            let natural = (start..start + 3)
                .filter(|&pos| natural_at(hand, suit, pos))
                .count();
            if natural >= 1 && 3 - natural <= jokers {
                return true;
            }
        }
    }
    false
}

/// Rank yang sedang "dimatikan": ada set mati dengan rank itu yang belum dihidupkan lagi.
pub fn locked_ranks(sets: &[DeadSet]) -> Vec<u8> {
    sets.iter().filter(|s| !s.revived).map(|s| s.rank).collect()
}

pub fn is_locked(sets: &[DeadSet], rank: u8) -> bool {
    sets.iter().any(|s| !s.revived && s.rank == rank)
}

/// Aturan rank terkunci untuk Extend: kalau rank sudah dimatikan, kartu aslinya TIDAK boleh
/// disambung sendirian (1 kartu) ke seri. Menyambung 2 kartu sekaligus (mis. J+K atau K+A)
/// dan membuat seri baru tetap boleh. Joker / A♠ tidak pernah terkunci.
pub fn check_extend_lock(cards: &[Placed], sets: &[DeadSet]) -> Result<(), GameError> {
    if let [p] = cards {
        if !p.card.is_joker() && is_locked(sets, p.card.rank) {
            return Err(GameError::RankLocked);
        }
    }
    Ok(())
}

/// Semua pola posisi yang mungkin untuk menyambung seri dengan 1 atau 2 kartu.
pub fn extend_positions(s: &Series) -> Vec<Vec<u8>> {
    let (lo, hi) = (s.lo(), s.hi());
    let mut out: Vec<Vec<u8>> = Vec::new();
    if lo > 1 {
        out.push(vec![lo - 1]);
    }
    if hi < 14 {
        out.push(vec![hi + 1]);
    }
    if lo > 2 {
        out.push(vec![lo - 2, lo - 1]);
    }
    if hi < 13 {
        out.push(vec![hi + 1, hi + 2]);
    }
    if lo > 1 && hi < 14 {
        out.push(vec![lo - 1, hi + 1]);
    }
    out
}

/// Kartu asli (bukan joker) dengan jenis dan posisi tertentu yang belum dipakai.
/// Rank di `avoid` dilewati.
fn natural(hand: &[Card], used: &[u8], avoid: &[u8], suit: Suit, pos: u8) -> Option<Card> {
    let rank = if pos == 14 { 1 } else { pos };
    hand.iter().copied().find(|c| {
        !c.is_joker()
            && c.suit == suit
            && c.rank == rank
            && !used.contains(&c.id)
            && !avoid.contains(&c.rank)
    })
}

/// Isi posisi-posisi untuk jenis `suit`: kartu asli kalau ada, joker kalau tidak.
/// None kalau joker kurang (atau tidak ada kartu asli padahal dibutuhkan).
/// `avoid` = rank yang tidak boleh dipakai sebagai kartu asli (rank terkunci).
pub fn fill(
    hand: &[Card],
    suit: Suit,
    positions: &[u8],
    avoid: &[u8],
    need_natural: bool,
) -> Option<Vec<Placed>> {
    let mut used: Vec<u8> = Vec::new();
    let mut spare: Vec<Card> = hand.iter().copied().filter(|c| c.is_joker()).collect();
    let mut out = Vec::with_capacity(positions.len());
    let mut naturals = 0;
    for &pos in positions {
        if let Some(card) = natural(hand, &used, avoid, suit, pos) {
            used.push(card.id);
            naturals += 1;
            out.push(Placed { card, pos });
        } else {
            let card = spare.pop()?;
            out.push(Placed { card, pos });
        }
    }
    if need_natural && naturals == 0 {
        return None;
    }
    Some(out)
}

/// Apakah ada minimal satu cara menyambung seri di meja (sesuai aturan rank terkunci)?
pub fn can_extend(hand: &[Card], table: &[Series], sets: &[DeadSet]) -> bool {
    let locked = locked_ranks(sets);
    table.iter().any(|s| {
        extend_positions(s).iter().any(|positions| {
            let avoid: &[u8] = if positions.len() == 1 { &locked } else { &[] };
            fill(hand, s.suit, positions, avoid, false).is_some()
        })
    })
}

/// Kartu mati: 3..=5 kartu seangka (jenis bebas) yang sudah diturunkan.
/// Selama set belum `revived`, rank-nya "terkunci": kartu rank itu hanya boleh masuk ke set ini
/// (AddDead), atau dimainkan 2 kartu sekaligus / lewat seri baru. Memasang 1 Joker
/// menghidupkan set (`revived`) dan membuka kunci rank-nya.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeadSet {
    pub owner: usize,
    pub rank: u8,
    pub cards: Vec<Card>,
    #[serde(default)]
    pub revived: bool,
}

pub fn build_dead_set(owner: usize, cards: &[Card]) -> Result<DeadSet, GameError> {
    if !(3..=5).contains(&cards.len()) {
        return Err(GameError::BadSize);
    }
    let mut rank: Option<u8> = None;
    for c in cards.iter().filter(|c| !c.is_joker()) {
        match rank {
            None => rank = Some(c.rank),
            Some(r) if r != c.rank => return Err(GameError::BadSet),
            _ => {}
        }
    }
    let rank = rank.ok_or(GameError::NeedNatural)?;
    Ok(DeadSet { owner, rank, cards: cards.to_vec(), revived: false })
}

/// Apakah tangan punya 3+ kartu seangka (joker boleh mengisi, minimal 1 kartu asli)
/// pada rank yang belum dimatikan?
pub fn can_kill(hand: &[Card], sets: &[DeadSet]) -> bool {
    let jokers = hand.iter().filter(|c| c.is_joker()).count();
    (1..=13u8).any(|rank| {
        if is_locked(sets, rank) {
            return false;
        }
        let n = hand.iter().filter(|c| !c.is_joker() && c.rank == rank).count();
        n >= 1 && n + jokers >= 3
    })
}

/// Tambah 1..=2 kartu seangka (joker boleh) ke set mati yang sudah ada.
pub fn add_to_dead_set(set: &mut DeadSet, cards: &[Card]) -> Result<(), GameError> {
    if set.revived {
        return Err(GameError::SetAlreadyRevived);
    }
    if !(1..=2).contains(&cards.len()) {
        return Err(GameError::BadSize);
    }
    if cards.iter().any(|c| !c.is_joker() && c.rank != set.rank) {
        return Err(GameError::BadSet);
    }
    set.cards.extend_from_slice(cards);
    Ok(())
}

pub fn can_add_dead(hand: &[Card], sets: &[DeadSet]) -> bool {
    sets.iter()
        .filter(|s| !s.revived)
        .any(|s| hand.iter().any(|c| c.is_joker() || c.rank == s.rank))
}

/// Hidupkan kembali set mati dengan memasang TEPAT 1 Joker (atau A♠) ke dalamnya.
/// Kartu di set tidak berubah dan tidak ada yang kembali ke tangan; joker ikut menetap di set.
/// Set ditandai `revived`, sehingga rank-nya boleh dimainkan lagi ke seri biasa.
pub fn revive_dead_set(set: &mut DeadSet, jokers: &[Card]) -> Result<(), GameError> {
    if set.revived {
        return Err(GameError::SetAlreadyRevived);
    }
    if jokers.len() != 1 {
        return Err(GameError::BadSize);
    }
    if !jokers[0].is_joker() {
        return Err(GameError::NeedNatural); // harus Joker
    }
    set.cards.push(jokers[0]);
    set.revived = true;
    Ok(())
}

/// Apakah pemain bisa menghidupkan salah satu set mati? (punya joker + ada set yang belum hidup)
pub fn can_revive_dead(hand: &[Card], sets: &[DeadSet]) -> bool {
    hand.iter().any(|c| c.is_joker()) && sets.iter().any(|s| !s.revived)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Suit::*;

        #[test]
    fn add_to_dead_set_rules() {
        let mut set = build_dead_set(0, &[c(13, Diamonds, 0), c(13, Spades, 1), c(13, Hearts, 2)]).unwrap();
        add_to_dead_set(&mut set, &[c(13, Clubs, 3)]).unwrap();
        assert_eq!(set.cards.len(), 4);
        assert_eq!(add_to_dead_set(&mut set, &[c(12, Clubs, 4)]), Err(GameError::BadSet));
        assert_eq!(
            add_to_dead_set(&mut set, &[c(13, Clubs, 5), c(13, Hearts, 6), c(13, Hearts, 7)]),
            Err(GameError::BadSize)
        );
        assert_eq!(set.cards.len(), 4);
    }
        #[test]
    fn dead_set_rules() {
        assert!(build_dead_set(0, &[c(9, Clubs, 0), c(9, Spades, 1), c(9, Diamonds, 2)]).is_ok());
        assert_eq!(
            build_dead_set(0, &[c(9, Clubs, 0), c(9, Spades, 1), c(10, Diamonds, 2)]),
            Err(GameError::BadSet)
        );
        assert!(build_dead_set(0, &[c(9, Clubs, 0), c(9, Spades, 1), c(14, Joker, 2)]).is_ok());
        assert_eq!(
            build_dead_set(0, &[c(9, Clubs, 0), c(9, Spades, 1)]),
            Err(GameError::BadSize)
        );
        assert_eq!(
            build_dead_set(0, &[c(14, Joker, 0), c(14, Joker, 1), c(14, Joker, 2)]),
            Err(GameError::NeedNatural)
        );
    }


    fn c(rank: u8, suit: Suit, id: u8) -> Card {
        Card { rank, suit, id }
    }
    fn pl(card: Card, pos: u8) -> Placed {
        Placed { card, pos }
    }

    #[test]
    fn builds_plain_series() {
        let s = build_series(0, vec![pl(c(5, Hearts, 0), 5), pl(c(6, Hearts, 1), 6), pl(c(7, Hearts, 2), 7)]).unwrap();
        assert_eq!((s.lo(), s.hi(), s.suit), (5, 7, Hearts));
    }

    #[test]
    fn rejects_mixed_suits_and_gaps() {
        let mixed = vec![pl(c(5, Hearts, 0), 5), pl(c(6, Spades, 1), 6), pl(c(7, Hearts, 2), 7)];
        assert_eq!(build_series(0, mixed), Err(GameError::SuitMismatch));
        let gap = vec![pl(c(5, Hearts, 0), 5), pl(c(6, Hearts, 1), 6), pl(c(8, Hearts, 2), 8)];
        assert_eq!(build_series(0, gap), Err(GameError::NotContiguous));
    }

    #[test]
    fn jokers_fill_any_slot_including_ace_of_spades() {
        let joker = c(14, Joker, 3);
        let ok = vec![pl(c(5, Hearts, 0), 5), pl(joker, 6), pl(c(7, Hearts, 2), 7)];
        assert!(build_series(0, ok).is_ok());

        let ace_spade = c(1, Spades, 4);
        let ok2 = vec![pl(ace_spade, 3), pl(c(4, Spades, 5), 4), pl(c(5, Spades, 6), 5)];
        assert!(build_series(0, ok2).is_ok());

        let only_jokers = vec![pl(joker, 3), pl(c(14, Joker, 7), 4), pl(c(14, Joker, 8), 5)];
        assert_eq!(build_series(0, only_jokers), Err(GameError::NeedNatural));
    }

    #[test]
    fn ace_is_low_or_high_but_never_wraps() {
        let high = vec![pl(c(12, Hearts, 0), 12), pl(c(13, Hearts, 1), 13), pl(c(1, Hearts, 2), 14)];
        assert!(build_series(0, high).is_ok());
        let low = vec![pl(c(1, Hearts, 0), 1), pl(c(2, Hearts, 1), 2), pl(c(3, Hearts, 2), 3)];
        assert!(build_series(0, low).is_ok());
        // K-A-2 tidak boleh
        let wrap = vec![pl(c(13, Hearts, 0), 13), pl(c(1, Hearts, 1), 14), pl(c(2, Hearts, 2), 15)];
        assert_eq!(build_series(0, wrap), Err(GameError::BadPosition));
    }

    #[test]
    fn extends_on_both_ends() {
        let mut s = build_series(0, vec![pl(c(5, Hearts, 0), 5), pl(c(6, Hearts, 1), 6), pl(c(7, Hearts, 2), 7)]).unwrap();
        extend_series(&mut s, vec![pl(c(4, Hearts, 3), 4), pl(c(8, Hearts, 4), 8)]).unwrap();
        assert_eq!((s.lo(), s.hi()), (4, 8));
        assert_eq!(extend_series(&mut s, vec![pl(c(10, Hearts, 5), 10)]), Err(GameError::CannotAttach));
        assert_eq!(extend_series(&mut s, vec![pl(c(9, Clubs, 6), 9)]), Err(GameError::SuitMismatch));
        assert_eq!((s.lo(), s.hi()), (4, 8)); // tidak berubah setelah error
    }

    #[test]
    fn can_open_detects_possible_series() {
        let ok = vec![c(5, Hearts, 0), c(7, Hearts, 1), c(14, Joker, 2)];
        assert!(can_open(&ok));
        let no = vec![c(5, Hearts, 0), c(9, Clubs, 1), c(12, Diamonds, 2)];
        assert!(!can_open(&no));
    }

    fn sample_dead(rank: u8) -> DeadSet {
        build_dead_set(0, &[c(rank, Diamonds, 40), c(rank, Clubs, 41), c(rank, Hearts, 42)]).unwrap()
    }

    #[test]
    fn killed_rank_blocks_only_single_card_extend() {
        let sets = vec![sample_dead(13)];
        assert!(is_locked(&sets, 13));
        assert!(!is_locked(&sets, 12));
        // 1 kartu K asli -> ditolak
        assert_eq!(
            check_extend_lock(&[pl(c(13, Hearts, 1), 13)], &sets),
            Err(GameError::RankLocked)
        );
        // rank lain, joker, dan A♠ tidak terkunci
        assert_eq!(check_extend_lock(&[pl(c(12, Hearts, 2), 12)], &sets), Ok(()));
        assert_eq!(check_extend_lock(&[pl(c(14, Joker, 3), 13)], &sets), Ok(()));
        assert_eq!(check_extend_lock(&[pl(c(1, Spades, 4), 13)], &sets), Ok(()));
        // 2 kartu sekaligus (J+K / K+A) tetap boleh
        assert_eq!(
            check_extend_lock(&[pl(c(11, Hearts, 5), 11), pl(c(13, Hearts, 6), 13)], &sets),
            Ok(())
        );
        assert_eq!(
            check_extend_lock(&[pl(c(13, Hearts, 6), 13), pl(c(1, Hearts, 7), 14)], &sets),
            Ok(())
        );
    }

    #[test]
    fn revive_needs_exactly_one_joker_and_unlocks_rank() {
        let mut sets = vec![sample_dead(13)];
        assert_eq!(revive_dead_set(&mut sets[0], &[]), Err(GameError::BadSize));
        assert_eq!(
            revive_dead_set(&mut sets[0], &[c(14, Joker, 5), c(14, Joker, 6)]),
            Err(GameError::BadSize)
        );
        assert_eq!(revive_dead_set(&mut sets[0], &[c(5, Hearts, 7)]), Err(GameError::NeedNatural));
        assert!(!sets[0].revived);
        assert_eq!(sets[0].cards.len(), 3);

        revive_dead_set(&mut sets[0], &[c(14, Joker, 5)]).unwrap();
        assert!(sets[0].revived);
        assert_eq!(sets[0].cards.len(), 4);
        assert!(!is_locked(&sets, 13));
        assert_eq!(
            revive_dead_set(&mut sets[0], &[c(14, Joker, 6)]),
            Err(GameError::SetAlreadyRevived)
        );
        assert_eq!(
            add_to_dead_set(&mut sets[0], &[c(13, Clubs, 8)]),
            Err(GameError::SetAlreadyRevived)
        );
    }

    #[test]
    fn move_checks_respect_dead_sets() {
        let sets = vec![sample_dead(13)];
        let kkk = vec![c(13, Hearts, 1), c(13, Clubs, 2), c(13, Spades, 3)];
        assert!(can_kill(&kkk, &[]));
        assert!(!can_kill(&kkk, &sets)); // K sudah dimatikan

        assert!(can_add_dead(&[c(13, Hearts, 1)], &sets));
        assert!(!can_add_dead(&[c(12, Hearts, 1)], &sets));
        assert!(can_revive_dead(&[c(14, Joker, 5)], &sets));
        assert!(!can_revive_dead(&[c(13, Hearts, 1)], &sets));

        let mut revived = sets.clone();
        revived[0].revived = true;
        assert!(!can_add_dead(&[c(13, Hearts, 1)], &revived));
        assert!(!can_revive_dead(&[c(14, Joker, 5)], &revived));
        assert!(can_kill(&kkk, &revived)); // sudah hidup, rank bebas lagi
    }

    #[test]
    fn can_extend_follows_rank_lock() {
        let series = build_series(
            0,
            vec![pl(c(10, Hearts, 10), 10), pl(c(11, Hearts, 11), 11), pl(c(12, Hearts, 12), 12)],
        )
        .unwrap();
        let table = vec![series];
        let sets = vec![sample_dead(13)];

        let only_k = vec![c(13, Hearts, 1)];
        assert!(can_extend(&only_k, &table, &[]));
        assert!(!can_extend(&only_k, &table, &sets)); // K sendirian terkunci

        let k_and_a = vec![c(13, Hearts, 1), c(1, Hearts, 2)];
        assert!(can_extend(&k_and_a, &table, &sets)); // K+A sekaligus boleh

        let joker_only = vec![c(14, Joker, 3)];
        assert!(can_extend(&joker_only, &table, &sets)); // joker mengisi pos K
    }
}