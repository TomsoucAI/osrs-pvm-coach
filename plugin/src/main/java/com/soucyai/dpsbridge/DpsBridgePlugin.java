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

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.inject.Inject;
import lombok.extern.slf4j.Slf4j;
import net.runelite.api.Actor;
import net.runelite.api.Client;
import net.runelite.api.EnumComposition;
import net.runelite.api.EnumID;
import net.runelite.api.EquipmentInventorySlot;
import net.runelite.api.GameState;
import net.runelite.api.Item;
import net.runelite.api.ItemContainer;
import net.runelite.api.NPC;
import net.runelite.api.ParamID;
import net.runelite.api.Player;
import net.runelite.api.Prayer;
import net.runelite.api.Skill;
import net.runelite.api.StructComposition;
import net.runelite.api.events.ActorDeath;
import net.runelite.api.events.FakeXpDrop;
import net.runelite.api.events.GameStateChanged;
import net.runelite.api.events.GameTick;
import net.runelite.api.events.HitsplatApplied;
import net.runelite.api.events.ItemContainerChanged;
import net.runelite.api.events.NpcDespawned;
import net.runelite.api.events.StatChanged;
import net.runelite.api.events.VarbitChanged;
import net.runelite.api.gameval.InventoryID;
import net.runelite.api.gameval.ItemID;
import net.runelite.api.gameval.VarPlayerID;
import net.runelite.api.gameval.VarbitID;
import net.runelite.client.callback.ClientThread;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import net.runelite.client.util.Filepath;

/**
 * Writes the player's combat state to ~/.runelite/plugin-data/dps_bridge/state.json so a local
 * MCP server can run DPS calculations on it. Writes the bank to bank.json in the same folder
 * each time the game sends the bank container. Counts the player's own landed defence-drain specs
 * on the current target as numbers in the state file. Read-only: never sends input to the game.
 */
@Slf4j
@PluginDescriptor(
	name = "DPS Bridge",
	internalName = "dps_bridge",
	description = "Exports gear, inventory, bank, rune pouch, spellbook, boosted levels, prayers, attack style, target and own spec drains for an external DPS calculator",
	tags = {"dps", "calculator", "mcp", "combat"}
)
public class DpsBridgePlugin extends Plugin
{
	private static final int STATE_VERSION = 2;
	private static final String STATE_FILE = "state.json";
	private static final String BANK_FILE = "bank.json";

	private static final int[] RUNE_POUCH_TYPES = {
		VarbitID.RUNE_POUCH_TYPE_1, VarbitID.RUNE_POUCH_TYPE_2, VarbitID.RUNE_POUCH_TYPE_3,
		VarbitID.RUNE_POUCH_TYPE_4, VarbitID.RUNE_POUCH_TYPE_5, VarbitID.RUNE_POUCH_TYPE_6
	};
	private static final int[] RUNE_POUCH_QUANTITIES = {
		VarbitID.RUNE_POUCH_QUANTITY_1, VarbitID.RUNE_POUCH_QUANTITY_2, VarbitID.RUNE_POUCH_QUANTITY_3,
		VarbitID.RUNE_POUCH_QUANTITY_4, VarbitID.RUNE_POUCH_QUANTITY_5, VarbitID.RUNE_POUCH_QUANTITY_6
	};
	// VarbitID.SPELLBOOK value -> name, in value order
	private static final String[] SPELLBOOKS = {"standard", "ancient", "lunar", "arceuus"};

	@Inject
	private Client client;

	@Inject
	private Gson gson;

	@Inject
	private ClientThread clientThread;

	private ExecutorService writer;
	private Filepath dir;
	private String lastJson;
	private JsonObject lastTarget;

	private final SpecTracker specs = new SpecTracker();
	private int specEnergy = -1;
	private int lastHpXp = -1;
	private int lastHpXpCycle = -1;

	@Override
	protected void startUp() throws Exception
	{
		// All file I/O goes through Filepath (Plugin Hub rule): .runelite/plugin-data/dps_bridge/
		dir = getPluginDirectory();
		writer = Executors.newSingleThreadExecutor(r ->
		{
			Thread t = new Thread(r, "dps-bridge-writer");
			t.setDaemon(true);
			return t;
		});
	}

	@Override
	protected void shutDown()
	{
		writeLoggedOut();
		writer.shutdown();
		lastJson = null;
		lastTarget = null;
		resetSpecs();
	}

	@Subscribe
	public void onGameStateChanged(GameStateChanged e)
	{
		if (e.getGameState() == GameState.LOGIN_SCREEN)
		{
			lastTarget = null;
			resetSpecs();
			writeLoggedOut();
		}
	}

	@Subscribe
	public void onGameTick(GameTick e)
	{
		Player me = client.getLocalPlayer();
		if (me == null)
		{
			return;
		}

		JsonObject j = new JsonObject();
		j.addProperty("version", STATE_VERSION);
		j.addProperty("loggedIn", true);
		j.addProperty("playerName", me.getName());
		j.add("equipment", equipment());
		j.add("realLevels", levels(false));
		j.add("boostedLevels", levels(true));
		j.add("prayers", prayers());
		addStyle(j);
		j.add("buffs", buffs());
		j.add("inventory", items(client.getItemContainer(InventoryID.INV)));
		j.add("runePouch", runePouch());
		addSpellbook(j);

		Actor target = me.getInteracting();
		if (target instanceof NPC)
		{
			NPC npc = (NPC) target;
			JsonObject t = new JsonObject();
			t.addProperty("id", npc.getId());
			t.addProperty("name", npc.getName());
			lastTarget = t; // remembered after the kill so you can still ask about it
			specs.target(npc.getIndex(), npc.getId());
		}
		j.add("target", lastTarget);

		specs.gameTick(client.getTickCount());
		j.add("drains", drains());

		String json = gson.toJson(j);
		if (json.equals(lastJson))
		{
			return; // only touch the disk when something changed
		}
		lastJson = json;

		JsonObject withTime = j.deepCopy();
		withTime.addProperty("timestamp", System.currentTimeMillis());
		write(STATE_FILE, gson.toJson(withTime));
	}

	// Own spec tracking, with the detection of the core Special Attack Counter: a drop of the
	// special-attack energy is a spec, the worn weapon names it, and the NPC that the player
	// interacts with is its target.
	@Subscribe
	public void onVarbitChanged(VarbitChanged e)
	{
		if (e.getVarpId() != VarPlayerID.SA_ENERGY)
		{
			return;
		}

		int energy = e.getValue();
		boolean dropped = specEnergy != -1 && energy < specEnergy;
		specEnergy = energy;
		if (!dropped)
		{
			return;
		}

		// This event runs before the player and NPC update, so getInteracting() is too early here.
		// invokeLater runs after the tick counter increments, so take the tick now.
		final int tick = client.getTickCount();
		clientThread.invokeLater(() ->
		{
			SpecTracker.Weapon weapon = specWeapon();
			Player me = client.getLocalPlayer();
			Actor target = me == null ? null : me.getInteracting();
			if (weapon == null || !(target instanceof NPC))
			{
				return;
			}

			NPC npc = (NPC) target;
			specs.target(npc.getIndex(), npc.getId());
			specs.specUsed(weapon, tick, lastHpXpCycle == client.getGameCycle());
		});
	}

	@Subscribe
	public void onHitsplatApplied(HitsplatApplied e)
	{
		// isMine: only the player's own hitsplats count
		if (e.getHitsplat().isMine() && e.getActor() instanceof NPC)
		{
			specs.ownHitsplat(((NPC) e.getActor()).getIndex(), e.getHitsplat().getAmount(), client.getTickCount());
		}
	}

	@Subscribe
	public void onStatChanged(StatChanged e)
	{
		if (e.getSkill() == Skill.HITPOINTS)
		{
			if (e.getXp() > lastHpXp)
			{
				lastHpXpCycle = client.getGameCycle();
			}
			lastHpXp = e.getXp();
		}
	}

	// At 200M Hitpoints xp the game sends a fake xp drop and no stat change.
	@Subscribe
	public void onFakeXpDrop(FakeXpDrop e)
	{
		if (e.getSkill() == Skill.HITPOINTS)
		{
			lastHpXpCycle = client.getGameCycle();
		}
	}

	@Subscribe
	public void onNpcDespawned(NpcDespawned e)
	{
		specs.npcGone(e.getNpc().getIndex());
	}

	@Subscribe
	public void onActorDeath(ActorDeath e)
	{
		if (e.getActor() instanceof NPC)
		{
			specs.npcGone(((NPC) e.getActor()).getIndex());
		}
	}

	private SpecTracker.Weapon specWeapon()
	{
		ItemContainer worn = client.getItemContainer(InventoryID.WORN);
		Item weapon = worn == null ? null : worn.getItem(EquipmentInventorySlot.WEAPON.getSlotIdx());
		if (weapon == null)
		{
			return null;
		}

		switch (weapon.getId())
		{
			case ItemID.DRAGON_WARHAMMER:
			case ItemID.BH_DRAGON_WARHAMMER_CORRUPTED:
				return SpecTracker.Weapon.DRAGON_WARHAMMER;
			case ItemID.ELDER_MAUL:
			case ItemID.ELDER_MAUL_ORNAMENT:
				return SpecTracker.Weapon.ELDER_MAUL;
			case ItemID.BGS:
			case ItemID.BGSG:
				return SpecTracker.Weapon.BANDOS_GODSWORD;
			default:
				return null;
		}
	}

	private JsonObject drains()
	{
		if (!specs.hasTarget())
		{
			return null;
		}

		JsonObject d = new JsonObject();
		d.addProperty("targetId", specs.getTargetId());
		d.addProperty("dwhHits", specs.getDwhHits());
		d.addProperty("elderMaulHits", specs.getElderMaulHits());
		d.addProperty("bgsDamage", specs.getBgsDamage());
		return d;
	}

	private void resetSpecs()
	{
		specs.reset();
		specEnergy = -1;
	}

	// The game sends the bank container only while the bank is open, so the last file stays as
	// the snapshot after the bank closes and after a client restart.
	@Subscribe
	public void onItemContainerChanged(ItemContainerChanged e)
	{
		if (e.getContainerId() != InventoryID.BANK)
		{
			return;
		}

		JsonObject j = new JsonObject();
		j.addProperty("timestamp", System.currentTimeMillis());
		j.add("items", items(e.getItemContainer()));
		write(BANK_FILE, gson.toJson(j));
	}

	private JsonArray items(ItemContainer container)
	{
		JsonArray a = new JsonArray();
		if (container == null)
		{
			return a;
		}

		for (Item item : container.getItems())
		{
			int id = item.getId();
			if (id <= 0 || id == ItemID.BANK_FILLER || item.getQuantity() <= 0
				|| client.getItemDefinition(id).getPlaceholderTemplateId() != -1)
			{
				continue; // empty slot, bank filler or bank placeholder: not an owned item
			}

			JsonObject o = new JsonObject();
			o.addProperty("id", id);
			o.addProperty("quantity", item.getQuantity());
			a.add(o);
		}
		return a;
	}

	private JsonArray runePouch()
	{
		JsonArray a = new JsonArray();
		EnumComposition runes = client.getEnum(EnumID.RUNEPOUCH_RUNE);
		for (int i = 0; i < RUNE_POUCH_TYPES.length; i++)
		{
			int type = client.getVarbitValue(RUNE_POUCH_TYPES[i]);
			int quantity = client.getVarbitValue(RUNE_POUCH_QUANTITIES[i]);
			int runeItemId = runes.getIntValue(type);
			if (type == 0 || quantity == 0 || runeItemId <= 0)
			{
				continue; // empty pouch slot, or a rune type that the enum does not map to an item
			}

			JsonObject o = new JsonObject();
			o.addProperty("runeItemId", runeItemId);
			o.addProperty("quantity", quantity);
			a.add(o);
		}
		return a;
	}

	private void addSpellbook(JsonObject j)
	{
		int book = client.getVarbitValue(VarbitID.SPELLBOOK);
		// null = a spellbook value that this plugin does not know
		j.addProperty("spellbook", book >= 0 && book < SPELLBOOKS.length ? SPELLBOOKS[book] : null);
	}

	private JsonObject equipment()
	{
		ItemContainer worn = client.getItemContainer(InventoryID.WORN);
		JsonObject eq = new JsonObject();
		slot(eq, worn, "head", EquipmentInventorySlot.HEAD);
		slot(eq, worn, "cape", EquipmentInventorySlot.CAPE);
		slot(eq, worn, "neck", EquipmentInventorySlot.AMULET);
		slot(eq, worn, "weapon", EquipmentInventorySlot.WEAPON);
		slot(eq, worn, "body", EquipmentInventorySlot.BODY);
		slot(eq, worn, "shield", EquipmentInventorySlot.SHIELD);
		slot(eq, worn, "legs", EquipmentInventorySlot.LEGS);
		slot(eq, worn, "hands", EquipmentInventorySlot.GLOVES);
		slot(eq, worn, "feet", EquipmentInventorySlot.BOOTS);
		slot(eq, worn, "ring", EquipmentInventorySlot.RING);
		slot(eq, worn, "ammo", EquipmentInventorySlot.AMMO);
		return eq;
	}

	private static void slot(JsonObject eq, ItemContainer worn, String key, EquipmentInventorySlot s)
	{
		Item item = worn == null ? null : worn.getItem(s.getSlotIdx());
		if (item == null || item.getId() <= 0)
		{
			eq.add(key, null);
		}
		else
		{
			eq.addProperty(key, item.getId());
		}
	}

	private JsonObject levels(boolean boosted)
	{
		JsonObject o = new JsonObject();
		lvl(o, "atk", Skill.ATTACK, boosted);
		lvl(o, "str", Skill.STRENGTH, boosted);
		lvl(o, "def", Skill.DEFENCE, boosted);
		lvl(o, "ranged", Skill.RANGED, boosted);
		lvl(o, "magic", Skill.MAGIC, boosted);
		lvl(o, "prayer", Skill.PRAYER, boosted);
		lvl(o, "hp", Skill.HITPOINTS, boosted);
		lvl(o, "mining", Skill.MINING, boosted);
		lvl(o, "herblore", Skill.HERBLORE, boosted);
		lvl(o, "farming", Skill.FARMING, boosted);
		return o;
	}

	private void lvl(JsonObject o, String key, Skill skill, boolean boosted)
	{
		o.addProperty(key, boosted ? client.getBoostedSkillLevel(skill) : client.getRealSkillLevel(skill));
	}

	private JsonArray prayers()
	{
		JsonArray a = new JsonArray();
		for (Prayer p : Prayer.values())
		{
			try
			{
				if (client.isPrayerActive(p))
				{
					a.add(p.name());
				}
			}
			catch (Exception ignored)
			{
				// prayers without a varbit in the current game mode
			}
		}
		return a;
	}

	private void addStyle(JsonObject j)
	{
		j.addProperty("attackStyleIndex", client.getVarpValue(VarPlayerID.COM_MODE));
		j.addProperty("castingMode", client.getVarbitValue(VarbitID.AUTOCAST_DEFMODE));
		int category = client.getVarbitValue(VarbitID.COMBAT_WEAPON_CATEGORY);
		j.addProperty("weaponCategory", category);

		try
		{
			EnumComposition styles = client.getEnum(EnumID.WEAPON_STYLES);
			int[] structs = client.getEnum(styles.getIntValue(category)).getIntVals();
			JsonArray slots = new JsonArray();
			for (int id : structs)
			{
				StructComposition s = client.getStructComposition(id);
				slots.add(s.getStringValue(ParamID.ATTACK_STYLE_NAME));
			}
			j.add("styleSlots", slots);
		}
		catch (Exception ex)
		{
			log.debug("Could not read weapon style structs", ex);
		}
	}

	private JsonObject buffs()
	{
		JsonObject b = new JsonObject();
		b.addProperty("onSlayerTask", client.getVarpValue(VarPlayerID.SLAYER_COUNT) > 0);
		b.addProperty("inWilderness", client.getVarbitValue(VarbitID.INSIDE_WILDERNESS) == 1);
		b.addProperty("kandarinDiary", client.getVarbitValue(VarbitID.KANDARIN_DIARY_HARD_COMPLETE) == 1);
		b.addProperty("chargeSpell", client.getVarpValue(VarPlayerID.MAGEARENA_CHARGE) > 0);
		return b;
	}

	private void writeLoggedOut()
	{
		lastJson = null;
		JsonObject j = new JsonObject();
		j.addProperty("version", STATE_VERSION);
		j.addProperty("loggedIn", false);
		j.addProperty("timestamp", System.currentTimeMillis());
		write(STATE_FILE, gson.toJson(j));
	}

	private void write(String fileName, String json)
	{
		if (writer == null || writer.isShutdown())
		{
			return;
		}
		writer.submit(() ->
		{
			try
			{
				dir.createDirectories();
				Filepath tmp = dir.join(fileName + ".tmp");
				Filepath file = dir.join(fileName);
				tmp.write(json.getBytes(StandardCharsets.UTF_8));
				try
				{
					tmp.moveTo(file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
				}
				catch (AtomicMoveNotSupportedException ex)
				{
					tmp.moveTo(file, StandardCopyOption.REPLACE_EXISTING);
				}
			}
			catch (IOException ex)
			{
				log.warn("DPS Bridge could not write {}", dir, ex);
			}
		});
	}
}
