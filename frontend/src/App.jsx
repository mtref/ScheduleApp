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
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast, ToastContainer } from "react-toastify";
import dayjs from "dayjs";

const formatDateForApi = (date) => dayjs(date).format("YYYY-MM-DD");

// --- Main App Component ---
export default function App() {
  // --- State Management ---
  const [selectedDate, setSelectedDate] = useState({
    startDate: new Date(),
    endDate: new Date(),
  });
  const [schedule, setSchedule] = useState({ date: null, data: [] });
  const [allNames, setAllNames] = useState([]);
  const [newName, setNewName] = useState("");
  const [isFetching, setIsFetching] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNamesModalOpen, setIsNamesModalOpen] = useState(false);
  const [isShuffleModalOpen, setIsShuffleModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());

  const isFetchingRef = useRef(false);

  const timeSlots = useMemo(() => [8, 9, 10, 11, 12, 13], []);

  // --- Data Fetching Effects ---
  useEffect(() => {
    if (!selectedDate?.startDate || isFetchingRef.current) return;

    const fetchSchedule = async () => {
      isFetchingRef.current = true;
      setIsFetching(true);
      try {
        const dateStr = formatDateForApi(selectedDate.startDate);
        const response = await fetch(`/api/schedule?date=${dateStr}`);
        if (!response.ok) throw new Error("Failed to fetch schedule.");
        const result = await response.json();
        setSchedule(result);
      } catch (error) {
        toast.error(error.message);
        setSchedule({
          date: formatDateForApi(selectedDate.startDate),
          data: [],
        });
      } finally {
        setIsFetching(false);
        isFetchingRef.current = false;
      }
    };
    fetchSchedule();
  }, [selectedDate, isSubmitting]);

  useEffect(() => {
    const fetchAllNames = async () => {
      try {
        const response = await fetch("/api/names");
        const result = await response.json();
        if (response.ok) setAllNames(result.data);
      } catch (error) {
        toast.error("Could not fetch master name list.");
      }
    };
    if (isNamesModalOpen) fetchAllNames();
  }, [isNamesModalOpen, isSubmitting]);

  useEffect(() => {
    const timerId = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timerId);
  }, []);

  // --- Memoized Derived State ---
  const isTodaySelected = useMemo(
    () => dayjs(selectedDate.startDate).isSame(new Date(), "day"),
    [selectedDate]
  );

  const displaySchedule = useMemo(() => {
    const currentHour = dayjs(currentTime).hour();
    const selectedDateStr = formatDateForApi(selectedDate.startDate);

    if (schedule.date !== selectedDateStr) {
      return timeSlots.map((time) => ({
        time,
        isAssigned: false,
        assignment: null,
        isCurrent: isTodaySelected && currentHour === time,
      }));
    }

    const assignments = schedule.data || [];
    return timeSlots.map((time) => {
      const assignment = assignments.find((s) => s.scheduled_time === time);
      return {
        time,
        isAssigned: !!assignment,
        assignment,
        isCurrent: isTodaySelected && currentHour === time,
      };
    });
  }, [schedule, timeSlots, currentTime, selectedDate, isTodaySelected]);

  // --- Event Handlers ---
  const handleAddName = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      toast.success(`'${newName}' added to the roster!`);
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
      const response = await fetch(`/api/names/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete name.");
      toast.info("Name removed from roster.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShuffle = async (e) => {
    e.preventDefault();
    if (password !== "123456") {
      toast.error("كلمة المرور غير صحيحة.");
      return;
    }

    setIsShuffleModalOpen(false);
    setIsSubmitting(true); // This will trigger a re-fetch

    try {
      const dateStr = formatDateForApi(selectedDate.startDate);
      const response = await fetch("/api/schedule/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateStr }),
      });

      if (!response.ok) {
        throw new Error("فشل في إعادة توزيع الجدول.");
      }

      const result = await response.json();
      // Directly update the schedule with the new data from the response
      setSchedule(result);
      toast.success("تمت إعادة توزيع الجدول بنجاح!");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSubmitting(false);
      setPassword("");
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 font-elmessiri">
        <div className="w-full max-w-4xl bg-gray-800 rounded-xl shadow-2xl p-6 md:p-8 space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              <Calendar className="mx-auto h-16 w-16 text-blue-400" />
            </motion.div>
            <h1 className="text-3xl md:text-4xl font-bold font-tajawal">
              جدول الدوام اليومي
            </h1>
            <p className="text-gray-400 text-lg">
              يتم عرض اسم عشوائي لكل ساعة عمل.
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="w-full md:w-72">
              <Datepicker
                value={selectedDate}
                onChange={(d) => setSelectedDate(d)}
                asSingle={true}
                useRange={false}
                inputClassName="w-full bg-gray-700 text-white placeholder-gray-400 rounded-md px-4 py-3 border-2 border-gray-600 focus:border-blue-500 focus:outline-none focus:ring-0"
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsNamesModalOpen(true)}
              className="w-full md:w-auto flex-grow flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-md transition-colors"
            >
              <ListPlus className="h-5 w-5" />
              <span>إدارة قائمة الأسماء</span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsShuffleModalOpen(true)}
              disabled={!isTodaySelected}
              className="w-full md:w-auto flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-md transition-colors"
            >
              <Shuffle className="h-5 w-5" />
              <span>إعادة توزيع اليوم</span>
            </motion.button>
          </div>

          {/* Schedule Grid */}
          <div className="pt-4">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-3">
              <Users className="h-7 w-7 text-gray-400" />
              <span>
                الجدول الزمني ليوم{" "}
                {dayjs(selectedDate.startDate).format("DD MMMM YYYY")}
              </span>
            </h2>
            {isFetching ? (
              <div className="flex justify-center items-center h-48">
                <Loader className="animate-spin h-10 w-10 text-blue-500" />
              </div>
            ) : (
              <div
                key={schedule.date || "loading-grid"}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {displaySchedule.map((slot) => (
                  <motion.div
                    key={slot.time}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`rounded-lg p-4 flex flex-col justify-between min-h-[120px] transition-all duration-300 ${
                      slot.isAssigned
                        ? "bg-gray-700 shadow-lg"
                        : "bg-gray-700/50 border-2 border-dashed border-gray-600"
                    } ${
                      slot.isCurrent
                        ? "ring-4 ring-offset-2 ring-offset-gray-800 ring-green-500"
                        : ""
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2 font-bold text-lg">
                        <Clock className="h-5 w-5 text-blue-400" />
                        <span>{`${slot.time}:00 - ${slot.time + 1}:00`}</span>
                      </div>
                    </div>
                    <div
                      className={`text-center rounded p-2 ${
                        slot.isCurrent ? "bg-green-500/20" : "bg-gray-800/50"
                      }`}
                    >
                      {slot.isAssigned ? (
                        <p className="font-tajawal text-xl font-bold text-white">
                          {slot.assignment.name}
                        </p>
                      ) : (
                        <p className="text-gray-500">فارغ</p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
            {!isFetching && schedule.data.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <ServerCrash className="mx-auto h-12 w-12 mb-2" />
                <p className="text-lg">لا توجد أسماء في القائمة لإنشاء جدول.</p>
                <p className="text-sm">أضف بعض الأسماء أولاً.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Names Management Modal */}
      <AnimatePresence>
        {isNamesModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
            onClick={() => setIsNamesModalOpen(false)}
          >
            <motion.div
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -50, opacity: 0 }}
              className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">إدارة قائمة الأسماء</h3>
                <button
                  onClick={() => setIsNamesModalOpen(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X />
                </button>
              </div>
              <form
                onSubmit={handleAddName}
                className="flex gap-2 p-2 bg-gray-900/50 rounded-md"
              >
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="أدخل اسماً جديداً..."
                  className="flex-grow bg-gray-700 text-white rounded-md px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-0"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-green-900 text-white font-bold py-2 px-4 rounded-md"
                >
                  <UserPlus className="h-5 w-5" />
                  <span>إضافة</span>
                </button>
              </form>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {allNames.map((name) => (
                  <div
                    key={name.id}
                    className="flex items-center justify-between bg-gray-700 p-2 rounded-md"
                  >
                    <span className="font-medium">{name.name}</span>
                    <button
                      onClick={() => handleDeleteName(name.id)}
                      disabled={isSubmitting}
                      className="text-gray-500 hover:text-red-500 disabled:text-gray-700"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shuffle Password Modal */}
      <AnimatePresence>
        {isShuffleModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
            onClick={() => setIsShuffleModalOpen(false)}
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
                <button
                  onClick={() => setIsShuffleModalOpen(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X />
                </button>
              </div>
              <p>الرجاء إدخال كلمة المرور للمتابعة.</p>
              <form onSubmit={handleShuffle}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="كلمة المرور..."
                  className="w-full bg-gray-700 text-white rounded-md px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-0"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-4 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-md"
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
