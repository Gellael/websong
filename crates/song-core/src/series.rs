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

/// Apakah ada minimal satu kartu yang bisa disambung ke seri di meja?
pub fn can_extend(hand: &[Card], table: &[Series]) -> bool {
    let has_joker = hand.iter().any(|c| c.is_joker());
    table.iter().any(|s| {
        let ends = [
            (s.lo() > 1).then(|| s.lo() - 1),
            (s.hi() < 14).then(|| s.hi() + 1),
        ];
        ends.iter()
            .flatten()
            .any(|&pos| has_joker || natural_at(hand, s.suit, pos))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Suit::*;

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
}