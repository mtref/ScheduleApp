import React, { useState, useEffect, useMemo, useRef } from "react";
import Datepicker from "react-tailwindcss-datepicker";
import {
  Calendar,
  Users,
  ListPlus,
  Loader,
  Trash2,
  Clock,
  X,
  ServerCrash,
  UserPlus,
  Shuffle,
  Edit,
  History,
  ShieldCheck,
  ShieldAlert,
  Award,
  ChevronsRight,
  ListOrdered,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast, ToastContainer } from "react-toastify";
import dayjs from "dayjs";
import "dayjs/locale/ar";
import weekday from "dayjs/plugin/weekday";
dayjs.extend(weekday);
dayjs.locale("ar");

const formatDateForApi = (date) => dayjs(date).format("YYYY-MM-DD");

// --- Reusable Components ---
// These components are defined before the main App component as they are used within it.
const Section = ({ title, icon: Icon, auditLog, children }) => (
  <div className="pt-4">
    {" "}
    <div className="flex justify-between items-center mb-4">
      {" "}
      <h2 className="text-2xl font-bold flex items-center gap-3">
        {" "}
        <Icon className="h-7 w-7 text-gray-400" /> <span>{title}</span>
      </h2>{" "}
      {auditLog && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          {" "}
          <History size={14} />{" "}
          <span>
            {" "}
            عُدل بواسطة: {auditLog.user_name} ({auditLog.reason})
          </span>{" "}
        </div>
      )}{" "}
    </div>{" "}
    {children}{" "}
  </div>
);

const Spinner = () => (
  <div className="flex justify-center items-center h-24">
    <Loader className="animate-spin h-8 w-8 text-blue-500" />
  </div>
);

const EmptyState = ({ text }) => (
  <div className="text-center py-8 text-gray-500 bg-gray-700/50 rounded-lg">
    <ServerCrash className="mx-auto h-10 w-10 mb-2" />
    <p>{text}</p>
  </div>
);

const HourlySlotCard = ({ slot, onEdit }) => (
  <motion.div
    layout
    onClick={() => onEdit(slot)}
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    className={`rounded-lg p-4 flex flex-col justify-between min-h-[120px] transition-all duration-300 cursor-pointer hover:ring-2 hover:ring-blue-500 ${
      slot.isAssigned
        ? "bg-gray-700 shadow-lg"
        : "bg-gray-700/50 border-2 border-dashed border-gray-600"
    } ${
      slot.isCurrent
        ? "ring-4 ring-offset-2 ring-offset-gray-800 ring-green-500"
        : ""
    }`}
  >
    {" "}
    <div className="flex justify-between items-center mb-2">
      {" "}
      <div className="flex items-center gap-2 font-bold text-lg">
        {" "}
        <Clock className="h-5 w-5 text-blue-400" />{" "}
        <span>{`${slot.time}:00 - ${slot.time + 1}:00`}</span>{" "}
      </div>{" "}
      {slot.assignment?.is_edited === 1 && (
        <div className="relative group">
          {" "}
          <span className="text-xs bg-yellow-500 text-gray-900 font-bold px-2 py-0.5 rounded-full">
            {" "}
            مُعدل{" "}
          </span>{" "}
          <div className="absolute text-right whitespace-nowrap bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 w-max p-2 text-xs text-white bg-gray-900 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {" "}
            {slot.assignment.original_name && (
              <div>
                <span className="font-bold">الأصلي:</span>{" "}
                {slot.assignment.original_name}
              </div>
            )}{" "}
            {slot.assignment.reason && (
              <div>
                <span className="font-bold">السبب:</span>{" "}
                {slot.assignment.reason}
              </div>
            )}{" "}
          </div>{" "}
        </div>
      )}{" "}
    </div>{" "}
    <div
      className={`text-center rounded p-2 flex-grow flex items-center justify-center ${
        slot.isCurrent ? "bg-green-500/20" : "bg-gray-800/50"
      }`}
    >
      {" "}
      {slot.isAssigned ? (
        <p className="font-tajawal text-xl font-bold text-white">
          {" "}
          {slot.assignment.name}{" "}
        </p>
      ) : (
        <p className="text-gray-500">فارغ</p>
      )}{" "}
    </div>{" "}
  </motion.div>
);

const GateCard = ({ assignment }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="bg-gray-700 rounded-lg p-6 text-center grid grid-cols-1 md:grid-cols-2 gap-4"
  >
    {" "}
    <div>
      <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
        الرئيسي
      </h3>
      <p className="text-4xl font-bold font-tajawal text-white">
        {assignment.main_name}
      </p>
    </div>{" "}
    <div className="border-t md:border-t-0 md:border-r border-gray-600 pt-4 md:pt-0 md:pr-4">
      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
        الاحتياط
      </h3>
      <p className="text-2xl font-medium text-gray-300">
        {assignment.backup_name || "لا يوجد"}
      </p>
    </div>{" "}
  </motion.div>
);

const WeeklyDutyCard = ({ duty, onPostpone }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="bg-gray-700 rounded-lg p-6 text-center"
  >
    {" "}
    <div className="flex justify-between items-start">
      {" "}
      <div className="flex-grow text-center">
        {" "}
        <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
          {" "}
          المناوب لهذه الفترة (الأسبوع رقم {duty.week_number} - من الأحد إلى
          السبت){" "}
        </h3>{" "}
        <p className="text-4xl font-bold font-tajawal text-white mt-2">
          {" "}
          {duty.name}{" "}
        </p>{" "}
      </div>{" "}
      <button
        onClick={onPostpone}
        className="text-gray-400 hover:text-purple-400 transition-colors p-2"
      >
        <ChevronsRight size={20} />
      </button>{" "}
    </div>{" "}
  </motion.div>
);

// --- Sub-Components for Modals ---
const RosterAbsenceModal = ({
  onClose,
  allNames,
  absences,
  isSubmitting,
  handleAddName,
  handleDeleteName,
  handleToggleAbsence,
  newName,
  setNewName,
  selectedDate,
}) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
    onClick={onClose}
  >
    {" "}
    <motion.div
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -50, opacity: 0 }}
      className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4"
      onClick={(e) => e.stopPropagation()}
    >
      {" "}
      <div className="flex justify-between items-center">
        <h3 className="text-2xl font-bold">
          قائمة الأسماء والغياب ليوم{" "}
          {dayjs(selectedDate.startDate).format("DD/MM/YYYY")}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X />
        </button>
      </div>{" "}
      <form
        onSubmit={handleAddName}
        className="flex gap-2 p-2 bg-gray-900/50 rounded-md"
      >
        {" "}
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="أضف اسماً جديداً للقائمة الرئيسية..."
          className="flex-grow bg-gray-700 text-white rounded-md px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-0"
          autoFocus
        />{" "}
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-green-900 text-white font-bold py-2 px-4 rounded-md"
        >
          <UserPlus className="h-5 w-5" />
          <span>إضافة</span>
        </button>{" "}
      </form>{" "}
      <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
        {" "}
        {allNames.map((name) => (
          <div
            key={name.id}
            className="flex items-center justify-between bg-gray-700 p-2 rounded-md"
          >
            <span className="font-medium">{name.name}</span>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-yellow-300">
                <input
                  type="checkbox"
                  checked={absences.includes(name.id)}
                  onChange={() => handleToggleAbsence(name.id)}
                  className="w-5 h-5 rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-yellow-600"
                />
                <span>غائب</span>
              </label>
              <button
                onClick={() => handleDeleteName(name.id)}
                disabled={isSubmitting}
                className="text-gray-500 hover:text-red-500 disabled:text-gray-700"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        ))}{" "}
      </div>{" "}
    </motion.div>{" "}
  </motion.div>
);

const ShuffleModal = ({ onClose, isSubmitting, handleShuffle }) => {
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const handleSubmit = (e) => {
    handleShuffle(e, userName, password, reason);
  };
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -50, opacity: 0 }}
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h3 className="text-2xl font-bold">تأكيد إعادة التوزيع</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X />
          </button>
        </div>
        <p>سيتم إعادة توزيع الأسماء للساعات القادمة فقط.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="اسمك للتدقيق..."
            className="w-full bg-gray-700 text-white rounded-md px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-0"
            required
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="كلمة المرور..."
            className="w-full bg-gray-700 text-white rounded-md px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-0"
            required
          />
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="سبب إعادة التوزيع..."
            className="w-full bg-gray-700 text-white rounded-md px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-0"
            required
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-md"
          >
            {isSubmitting ? (
              <Loader className="animate-spin h-5 w-5" />
            ) : (
              <Shuffle className="h-5 w-5" />
            )}
            <span>تأكيد</span>
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
};

const EditSlotModal = ({
  onClose,
  isSubmitting,
  handleOverrideSlot,
  slot,
  presentNames,
}) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
    onClick={onClose}
  >
    <motion.div
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -50, opacity: 0 }}
      className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex justify-between items-center">
        <h3 className="text-2xl font-bold">تعديل خانة الساعة {slot.time}:00</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X />
        </button>
      </div>
      <form onSubmit={handleOverrideSlot} className="space-y-4">
        <div>
          <label
            htmlFor="newName"
            className="block text-sm font-medium text-gray-300 mb-1"
          >
            اختر اسماً جديداً
          </label>
          <select
            id="newName"
            name="newName"
            defaultValue={slot.assignment?.name_id}
            className="w-full bg-gray-700 text-white rounded-md px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-0"
          >
            {presentNames.map((name) => (
              <option key={name.id} value={name.id}>
                {name.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="reason"
            className="block text-sm font-medium text-gray-300 mb-1"
          >
            السبب
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            defaultValue={slot.assignment?.reason || ""}
            placeholder="سبب التعديل..."
            className="w-full bg-gray-700 text-white rounded-md px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-0"
            required
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-md"
        >
          {isSubmitting ? (
            <Loader className="animate-spin h-5 w-5" />
          ) : (
            <Edit className="h-5 w-5" />
          )}
          <span>حفظ التعديل</span>
        </button>
      </form>
    </motion.div>
  </motion.div>
);

// NEW: Weekly Duty List Modal Component
const WeeklyDutyListModal = ({ onClose }) => {
  const [weeklyDuties, setWeeklyDuties] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchUpcomingDuties = async () => {
      try {
        setIsLoading(true);
        const res = await fetch("/api/weekly-duties/upcoming");
        if (!res.ok) throw new Error("Failed to fetch weekly duties list.");
        const result = await res.json();
        setWeeklyDuties(result.data);
      } catch (err) {
        setError(err.message);
        toast.error(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUpcomingDuties();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -50, opacity: 0 }}
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center pb-4 border-b border-gray-700">
          <h3 className="text-2xl font-bold">
            قائمة المناوبات الأسبوعية القادمة
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X />
          </button>
        </div>

        {isLoading ? (
          <Spinner />
        ) : error ? (
          <EmptyState text={`خطأ في تحميل البيانات: ${error}`} />
        ) : weeklyDuties.length === 0 ? (
          <EmptyState text="لا توجد مناوبات أسبوعية قادمة." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-700">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    الأسبوع
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    تاريخ البدء
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    المناوب
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    مُعدل
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    الأصلي (السبب)
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800 divide-y divide-gray-700">
                {weeklyDuties.map((duty) => (
                  <tr
                    key={duty.week_start_date}
                    className="hover:bg-gray-700 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                      {duty.week_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {dayjs(duty.week_start_date).format("DD/MM/YYYY")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                      {duty.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {duty.is_edited ? (
                        <span className="bg-yellow-500 text-gray-900 font-bold px-2 py-0.5 rounded-full text-xs">
                          نعم
                        </span>
                      ) : (
                        <span className="text-gray-400">لا</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-300 max-w-xs truncate">
                      {duty.is_edited && duty.original_name ? (
                        <div className="flex flex-col">
                          <span>{duty.original_name}</span>
                          <span className="text-xs text-gray-500">
                            ({duty.reason || "لا يوجد سبب"})
                          </span>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

// --- Main App Component ---
// The App component definition should come AFTER all the reusable components it uses.
export default function App() {
  // --- State Management ---
  const [selectedDate, setSelectedDate] = useState({
    startDate: new Date(),
    endDate: new Date(),
  });
  const [hourlySchedule, setHourlySchedule] = useState([]);
  const [gateAssignment, setGateAssignment] = useState(null);
  const [weeklyDuty, setWeeklyDuty] = useState(null);
  const [auditLog, setAuditLog] = useState(null);
  const [allNames, setAllNames] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [newName, setNewName] = useState("");
  const [isFetching, setIsFetching] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);
  const [isShuffleModalOpen, setIsShuffleModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  // NEW: State for the weekly duty list modal
  const [isWeeklyDutyListModalOpen, setIsWeeklyDutyListModalOpen] =
    useState(false);

  const isFetchingRef = useRef(false);

  const timeSlots = useMemo(() => [8, 9, 10, 11, 12, 13], []);

  // --- Data Fetching Effects ---
  useEffect(() => {
    if (!selectedDate?.startDate || isFetchingRef.current) return;

    const fetchAllData = async () => {
      isFetchingRef.current = true;
      setIsFetching(true);
      try {
        const dateStr = formatDateForApi(selectedDate.startDate);
        const res = await fetch(`/api/daily-data?date=${dateStr}`);
        if (!res.ok) throw new Error("Failed to fetch daily data.");
        const result = await res.json();

        setHourlySchedule(result.hourly || []);
        setGateAssignment(result.gate || null);
        setWeeklyDuty(result.weeklyDuty || null);
        setAuditLog(result.audit || null);
        setAbsences(result.absences || []);
      } catch (error) {
        toast.error(error.message);
        setHourlySchedule([]);
        setGateAssignment(null);
        setWeeklyDuty(null);
        setAuditLog(null);
        setAbsences([]);
      } finally {
        setIsFetching(false);
        isFetchingRef.current = false;
      }
    };
    fetchAllData();
  }, [selectedDate, isSubmitting]);

  useEffect(() => {
    const fetchMasterNames = async () => {
      try {
        const namesRes = await fetch("/api/names");
        if (!namesRes.ok) throw new Error("Could not fetch names");
        const namesResult = await namesRes.json();
        setAllNames(namesResult.data || []);
      } catch (error) {
        toast.error(error.message);
      }
    };
    if (isRosterModalOpen || isEditModalOpen) {
      fetchMasterNames();
    }
  }, [isRosterModalOpen, isEditModalOpen]);

  useEffect(() => {
    const timerId = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timerId);
  }, []);

  // --- Memoized Derived State ---
  const isTodaySelected = useMemo(
    () => dayjs(selectedDate.startDate).isSame(new Date(), "day"),
    [selectedDate]
  );
  const presentNames = useMemo(
    () => allNames.filter((name) => !absences.includes(name.id)),
    [allNames, absences]
  );
  const displaySchedule = useMemo(() => {
    const currentHour = dayjs(currentTime).hour();
    return timeSlots.map((time) => {
      const assignment = hourlySchedule.find((s) => s.scheduled_time === time);
      return {
        time,
        isAssigned: !!assignment,
        assignment,
        isCurrent: isTodaySelected && currentHour === time,
      };
    });
  }, [hourlySchedule, timeSlots, currentTime, isTodaySelected]);

  // --- Event Handlers ---
  const handleAddName = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      toast.success(`'${newName}' added to roster!`);
      setNewName("");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteName = async (id) => {
    setIsSubmitting(true);
    try {
      await fetch(`/api/names/${id}`, { method: "DELETE" });
      toast.info("Name removed from roster.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleAbsence = async (nameId) => {
    setIsSubmitting(true);
    try {
      await fetch("/api/absences/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name_id: nameId,
          date: formatDateForApi(selectedDate.startDate),
        }),
      });
    } catch (error) {
      toast.error("Failed to update absence status.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShuffle = async (e, userName, password, reason) => {
    e.preventDefault();
    if (password !== "123456") return toast.error("كلمة المرور غير صحيحة.");
    if (!userName.trim()) return toast.error("الرجاء إدخال اسمك للتدقيق.");
    if (!reason.trim()) return toast.error("الرجاء إدخال سبب لإعادة التوزيع.");
    setIsShuffleModalOpen(false);
    setIsSubmitting(true);
    try {
      const dateStr = formatDateForApi(selectedDate.startDate);
      const currentHour = dayjs(currentTime).hour();
      const res = await fetch("/api/schedule/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: dateStr,
          hour: currentHour,
          userName,
          reason,
        }),
      });
      if (!res.ok) throw new Error("Failed to regenerate schedule.");
      const result = await res.json();
      setHourlySchedule(result.hourly || []);
      setAuditLog(result.audit || null);
      toast.success("تمت إعادة توزيع الجدول بنجاح!");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditModal = (slot) => {
    setEditingSlot(slot);
    setIsEditModalOpen(true);
  };

  const handleOverrideSlot = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newNameId = formData.get("newName");
    const reason = formData.get("reason");
    if (!editingSlot || !newNameId || !reason.trim())
      return toast.error("الرجاء اختيار اسم وذكر سبب التعديل.");
    setIsSubmitting(true);
    setIsEditModalOpen(false);
    try {
      await fetch("/api/schedule/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: formatDateForApi(selectedDate.startDate),
          time: editingSlot.time,
          name_id: parseInt(newNameId),
          reason: reason.trim(),
        }),
      });
      toast.success("تم تعديل الخانة بنجاح!");
    } catch (error) {
      toast.error("فشل تعديل الخانة.");
    } finally {
      setEditingSlot(null);
      setIsSubmitting(false);
    }
  };

  const handlePostponeWeeklyDuty = async () => {
    if (!weeklyDuty) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/weekly-duty/postpone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week_start_date: dayjs(selectedDate.startDate)
            .weekday(0)
            .format("YYYY-MM-DD"),
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to postpone duty.");
      }
      toast.success("تم ترحيل المناوبة الأسبوعية بنجاح!");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDateChange = (newValue) => {
    if (newValue && newValue.startDate) setSelectedDate(newValue);
    else toast.warn("يجب تحديد تاريخ لعرض الجدول.");
  };

  return (
    <>
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 font-elmessiri">
        <div className="w-full max-w-4xl bg-gray-800 rounded-xl shadow-2xl p-6 md:p-8 space-y-6">
          <div className="text-center space-y-2">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              {" "}
              <Calendar className="mx-auto h-16 w-16 text-blue-400" />{" "}
            </motion.div>
            <h1 className="text-3xl md:text-4xl font-bold font-tajawal">
              {" "}
              جدول الدوام اليومي{" "}
            </h1>
            <h2 className="text-2xl font-bold text-gray-300">
              {dayjs(selectedDate.startDate).format(
                "dddd, DD MMMM tetrachloride"
              )}
            </h2>
          </div>
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="w-full md:w-72">
              {" "}
              <Datepicker
                value={selectedDate}
                onChange={handleDateChange}
                asSingle={true}
                useRange={false}
                inputClassName="w-full bg-gray-700 text-white placeholder-gray-400 rounded-md py-3 pr-4 pl-12 border-2 border-gray-600 focus:border-blue-500 focus:outline-none focus:ring-0"
              />{" "}
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsRosterModalOpen(true)}
              className="w-full md:w-auto flex-grow flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-md transition-colors"
            >
              {" "}
              <ListPlus className="h-5 w-5" />{" "}
              <span>قائمة الأسماء والغياب</span>{" "}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsShuffleModalOpen(true)}
              disabled={!isTodaySelected}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-md transition-colors"
            >
              {" "}
              <Shuffle className="h-5 w-5" /> <span>إعادة توزيع الساعات</span>{" "}
            </motion.button>
            {/* NEW: Button to open Weekly Duty List Modal */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsWeeklyDutyListModalOpen(true)}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-md transition-colors"
            >
              <ListOrdered className="h-5 w-5" />{" "}
              <span>عرض المناوبات القادمة</span>{" "}
            </motion.button>
          </div>

          <div className="space-y-8">
            <Section
              title="الجدول الزمني للساعات"
              icon={Users}
              auditLog={auditLog}
            >
              {isFetching ? (
                <Spinner />
              ) : (
                <div
                  key={`hourly-${selectedDate.startDate.toString()}`}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
                >
                  {displaySchedule.map((slot) => (
                    <HourlySlotCard
                      key={slot.time}
                      slot={slot}
                      onEdit={handleOpenEditModal}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section title="دوام البوابة" icon={ShieldCheck}>
              {isFetching ? (
                <Spinner />
              ) : gateAssignment ? (
                <GateCard assignment={gateAssignment} />
              ) : (
                <EmptyState text="لا يمكن تحديد دوام البوابة." />
              )}
            </Section>

            <Section title="مناوبة الأسبوع" icon={Award}>
              {isFetching ? (
                <Spinner />
              ) : weeklyDuty ? (
                <WeeklyDutyCard
                  duty={weeklyDuty}
                  onPostpone={handlePostponeWeeklyDuty}
                />
              ) : (
                <EmptyState text="لا يمكن تحديد المناوب الأسبوعي." />
              )}
            </Section>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {isRosterModalOpen && (
          <RosterAbsenceModal
            onClose={() => setIsRosterModalOpen(false)}
            allNames={allNames}
            absences={absences}
            isSubmitting={isSubmitting}
            handleAddName={handleAddName}
            handleDeleteName={handleDeleteName}
            handleToggleAbsence={handleToggleAbsence}
            newName={newName}
            setNewName={setNewName}
            selectedDate={selectedDate}
          />
        )}
        {isShuffleModalOpen && (
          <ShuffleModal
            onClose={() => setIsShuffleModalOpen(false)}
            isSubmitting={isSubmitting}
            handleShuffle={handleShuffle}
          />
        )}
        {isEditModalOpen && (
          <EditSlotModal
            onClose={() => setIsEditModalOpen(false)}
            isSubmitting={isSubmitting}
            handleOverrideSlot={handleOverrideSlot}
            slot={editingSlot}
            presentNames={presentNames}
          />
        )}
        {/* NEW: Weekly Duty List Modal */}
        {isWeeklyDutyListModalOpen && (
          <WeeklyDutyListModal
            onClose={() => setIsWeeklyDutyListModalOpen(false)}
          />
        )}
      </AnimatePresence>
      <ToastContainer
        position="bottom-left"
        autoClose={4000}
        theme="dark"
        rtl={true}
      />
    </>
  );
}
