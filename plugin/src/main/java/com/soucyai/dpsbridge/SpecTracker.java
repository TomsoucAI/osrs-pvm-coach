/*
 * Copyright (c) 2026, soucyai
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
package com.soucyai.dpsbridge;

import lombok.Getter;

/**
 * Counts the player's own landed defence-drain specs on one NPC: Dragon warhammer hits, Elder maul
 * hits and Bandos godsword damage. The detection follows RuneLite's core Special Attack Counter
 * (specialcounter/SpecialCounterPlugin.java), without its infobox, party messages and Tekton rules.
 * It holds numbers only and reads nothing from the game: the plugin feeds it.
 */
final class SpecTracker
{
	enum Weapon
	{
		DRAGON_WARHAMMER,
		ELDER_MAUL,
		BANDOS_GODSWORD
	}

	private static final int NO_TARGET = -1;
	private static final int NO_HITSPLAT = -1;
	// The hitsplat of a melee spec lands 1 game tick after the special-attack energy drops.
	private static final int HIT_DELAY_TICKS = 1;

	private int targetIndex = NO_TARGET;
	@Getter
	private int targetId;
	@Getter
	private int dwhHits;
	@Getter
	private int elderMaulHits;
	@Getter
	private int bgsDamage;

	// The spec that waits for its result, or null.
	private Weapon pending;
	private int hitTick;
	private boolean hpXpGained;
	private int lastHitsplat = NO_HITSPLAT;

	boolean hasTarget()
	{
		return targetIndex != NO_TARGET;
	}

	/**
	 * The player interacts with this NPC. An NPC other than the counted one resets the counts.
	 */
	void target(int npcIndex, int npcId)
	{
		if (npcIndex != targetIndex)
		{
			reset();
			targetIndex = npcIndex;
		}
		targetId = npcId; // an NPC can change id during a fight
	}

	/**
	 * The player used a spec on the target.
	 *
	 * @param tick       the game tick on which the special-attack energy dropped
	 * @param hpXpGained true when Hitpoints xp rose in the same client cycle (the Elder maul's hit signal)
	 */
	void specUsed(Weapon weapon, int tick, boolean hpXpGained)
	{
		pending = weapon;
		hitTick = tick + HIT_DELAY_TICKS;
		this.hpXpGained = hpXpGained;
		lastHitsplat = NO_HITSPLAT;
	}

	/**
	 * One of the player's own hitsplats landed on an NPC.
	 */
	void ownHitsplat(int npcIndex, int amount, int tick)
	{
		if (pending != null && npcIndex == targetIndex && tick == hitTick)
		{
			// Order on one tick: delayed hits, thrall, vengeance, instant hits. A melee spec is instant, so it is last.
			lastHitsplat = amount;
		}
	}

	/**
	 * Resolves the waiting spec. Call once on each game tick.
	 */
	void gameTick(int tick)
	{
		if (pending == null)
		{
			return;
		}

		if (pending == Weapon.ELDER_MAUL)
		{
			// The Elder maul's hitsplat comes 2 ticks later, so the core does not wait for it: xp means a hit.
			if (hpXpGained)
			{
				elderMaulHits++;
			}
			pending = null;
		}
		else if (tick >= hitTick)
		{
			// No hitsplat on the hit tick, or a hitsplat of 0, is a miss: count nothing.
			if (lastHitsplat > 0)
			{
				if (pending == Weapon.BANDOS_GODSWORD)
				{
					bgsDamage += lastHitsplat;
				}
				else
				{
					dwhHits++;
				}
			}
			pending = null;
		}
	}

	/**
	 * This NPC died or despawned.
	 */
	void npcGone(int npcIndex)
	{
		if (npcIndex == targetIndex)
		{
			reset();
		}
	}

	void reset()
	{
		targetIndex = NO_TARGET;
		targetId = 0;
		dwhHits = 0;
		elderMaulHits = 0;
		bgsDamage = 0;
		pending = null;
	}
}
